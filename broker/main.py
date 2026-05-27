import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_user_token() -> str:
    return os.getenv("USER_TOKEN", "dev-user-token")


def get_agent_token() -> str:
    return os.getenv("AGENT_TOKEN", "dev-agent-token")


class CreateTaskRequest(BaseModel):
    device_id: str = Field(default="gokul-pc")
    action: str = Field(default="run_agent")
    payload: Dict[str, Any] = Field(default_factory=dict)


class BrokerState:
    def __init__(self) -> None:
        self.tasks: Dict[str, Dict[str, Any]] = {}
        self.devices: Dict[str, Dict[str, Any]] = {
            "gokul-pc": {
                "device_id": "gokul-pc",
                "online": False,
                "last_seen": None,
            }
        }
        self.agent_connections: Dict[str, WebSocket] = {}
        self.client_connections: set[WebSocket] = set()
        self.lock = asyncio.Lock()

    async def broadcast(self, event: Dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        payload = json.dumps(event)
        for ws in list(self.client_connections):
            try:
                await ws.send_text(payload)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.client_connections.discard(ws)


state = BrokerState()

app = FastAPI(title="personaliz-broker")

allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def require_user_token(x_user_token: Optional[str]) -> None:
    if x_user_token != get_user_token():
        raise HTTPException(status_code=401, detail="Invalid X-USER-TOKEN")


async def require_agent_token(x_agent_token: Optional[str]) -> None:
    if x_agent_token != get_agent_token():
        raise HTTPException(status_code=401, detail="Invalid X-AGENT-TOKEN")


@app.post("/api/tasks")
async def create_task(
    req: CreateTaskRequest,
    x_user_token: Optional[str] = Header(default=None, alias="X-USER-TOKEN"),
):
    await require_user_token(x_user_token)

    task_id = str(uuid.uuid4())
    task = {
        "id": task_id,
        "device_id": req.device_id,
        "action": req.action,
        "payload": req.payload,
        "status": "queued",
        "result": None,
        "error": None,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }

    async with state.lock:
        state.tasks[task_id] = task
        state.devices.setdefault(
            req.device_id,
            {"device_id": req.device_id, "online": False, "last_seen": None},
        )
        agent_ws = state.agent_connections.get(req.device_id)

    await state.broadcast({"type": "task.created", "task": task})

    if agent_ws:
        try:
            await agent_ws.send_json({"type": "task.created", "task": task})
        except Exception:
            pass

    return {"task_id": task_id}


@app.get("/api/tasks/{task_id}")
async def get_task(
    task_id: str,
    x_user_token: Optional[str] = Header(default=None, alias="X-USER-TOKEN"),
):
    await require_user_token(x_user_token)

    task = state.tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.get("/api/devices")
async def list_devices(
    x_user_token: Optional[str] = Header(default=None, alias="X-USER-TOKEN"),
):
    await require_user_token(x_user_token)
    return {"devices": list(state.devices.values())}


@app.websocket("/ws/agent")
async def ws_agent(
    websocket: WebSocket,
    device_id: Optional[str] = Query(default=None),
):
    header_token = websocket.headers.get("x-agent-token")
    if header_token != get_agent_token():
        await websocket.close(code=4401)
        return

    await websocket.accept()

    try:
        resolved_device_id = device_id
        if not resolved_device_id:
            first_message = await websocket.receive_json()
            if first_message.get("type") == "agent.register":
                resolved_device_id = first_message.get("device_id")

        if not resolved_device_id:
            await websocket.send_json({"type": "error", "message": "device_id is required"})
            await websocket.close(code=4400)
            return

        async with state.lock:
            state.agent_connections[resolved_device_id] = websocket
            state.devices[resolved_device_id] = {
                "device_id": resolved_device_id,
                "online": True,
                "last_seen": now_iso(),
            }

        await state.broadcast({"type": "device.online", "device_id": resolved_device_id})

        while True:
            event = await websocket.receive_json()
            event_type = event.get("type")
            event_to_publish = event
            if event_type == "heartbeat":
                async with state.lock:
                    if resolved_device_id in state.devices:
                        state.devices[resolved_device_id]["last_seen"] = now_iso()
                await websocket.send_json({"type": "heartbeat.ack", "device_id": resolved_device_id})
                continue

            task_id = event.get("task_id")
            if task_id and task_id in state.tasks:
                async with state.lock:
                    task = state.tasks[task_id]
                    if event_type == "task.start":
                        task["status"] = "running"
                    elif event_type == "task.log":
                        task["status"] = task.get("status") or "running"
                    elif event_type == "task.done":
                        if event.get("success", True):
                            task["status"] = "done"
                            task["result"] = event.get("result")
                            task["error"] = None
                        else:
                            task["status"] = "error"
                            task["error"] = event.get("error") or "Task failed"
                    task["updated_at"] = now_iso()
                    event_to_publish = {**event, "task": task}
            await state.broadcast(event_to_publish)

    except WebSocketDisconnect:
        pass
    finally:
        if device_id:
            resolved = device_id
        else:
            resolved = None
            for key, ws in list(state.agent_connections.items()):
                if ws == websocket:
                    resolved = key
                    break

        if resolved:
            async with state.lock:
                state.agent_connections.pop(resolved, None)
                state.devices.setdefault(resolved, {"device_id": resolved})
                state.devices[resolved]["online"] = False
                state.devices[resolved]["last_seen"] = now_iso()
            await state.broadcast({"type": "device.offline", "device_id": resolved})


@app.websocket("/ws/client")
async def ws_client(
    websocket: WebSocket,
    token: Optional[str] = Query(default=None),
):
    header_token = websocket.headers.get("x-user-token")
    if header_token != get_user_token() and token != get_user_token():
        await websocket.close(code=4401)
        return

    await websocket.accept()
    state.client_connections.add(websocket)

    try:
        await websocket.send_json({
            "type": "snapshot",
            "devices": list(state.devices.values()),
        })
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "heartbeat":
                await websocket.send_json({"type": "heartbeat.ack"})
    except WebSocketDisconnect:
        pass
    finally:
        state.client_connections.discard(websocket)
