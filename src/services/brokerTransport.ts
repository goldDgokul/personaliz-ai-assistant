export const USER_TOKEN_KEY = 'user_access_token';

export interface BrokerTaskRequest {
  device_id: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface BrokerEvent {
  type: string;
  [key: string]: any;
}

export const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const getBrokerUrl = (): string =>
  (import.meta.env.VITE_BROKER_URL as string | undefined)?.trim() || 'https://personaliz-broker.onrender.com';

export const toWsUrl = (httpUrl: string): string => {
  if (httpUrl.startsWith('https://')) return httpUrl.replace('https://', 'wss://');
  if (httpUrl.startsWith('http://')) return httpUrl.replace('http://', 'ws://');
  return httpUrl;
};

export const createBrokerTask = async (token: string, task: BrokerTaskRequest): Promise<string> => {
  const response = await fetch(`${getBrokerUrl()}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-USER-TOKEN': token,
    },
    body: JSON.stringify(task),
  });

  if (!response.ok) {
    throw new Error(`Broker task request failed (${response.status})`);
  }

  const data = await response.json();
  if (!data.task_id) {
    throw new Error('Broker did not return task_id');
  }
  return data.task_id as string;
};

export const listBrokerDevices = async (token: string): Promise<Array<{ device_id: string; online: boolean }>> => {
  const response = await fetch(`${getBrokerUrl()}/api/devices`, {
    headers: { 'X-USER-TOKEN': token },
  });
  if (!response.ok) {
    throw new Error(`Broker device query failed (${response.status})`);
  }
  const data = await response.json();
  return (data.devices || []) as Array<{ device_id: string; online: boolean }>;
};

export const connectBrokerClientSocket = (
  token: string,
  onEvent: (event: BrokerEvent) => void,
  onStatus: (connected: boolean) => void,
): (() => void) => {
  const wsUrl = `${toWsUrl(getBrokerUrl())}/ws/client?token=${encodeURIComponent(token)}`;
  const socket = new WebSocket(wsUrl);

  socket.onopen = () => onStatus(true);
  socket.onclose = () => onStatus(false);
  socket.onerror = () => onStatus(false);
  socket.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      onEvent(parsed);
    } catch {
      // ignore malformed payloads
    }
  };

  return () => {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };
};
