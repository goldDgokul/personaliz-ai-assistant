#!/usr/bin/env python3
"""
Agent Execution Engine for Personaliz Desktop Assistant
Handles agent execution, LinkedIn posting, and browser automation.

CLI interface (subcommands):
  linkedin_post     --content <text> --sandbox <true|false> [--profile-dir <path>]
  linkedin_comment_hashtag --hashtag <tag> --comment <text> --sandbox <true|false> [--profile-dir <path>]
  trending_topics   (returns JSON list of topics)

Legacy positional interface (kept for backward compat):
  <agent_id> [sandbox|live]
"""

import sys
import json
import time
import argparse
import os
from datetime import datetime
from typing import Dict, List, Any, Optional

PLAYWRIGHT_AVAILABLE = False
try:
    from playwright.sync_api import sync_playwright, BrowserContext, Page
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_profile_dir() -> str:
    """Return a stable directory to store the Chromium user profile."""
    base = os.environ.get("APPDATA") or os.path.expanduser("~/.local/share")
    return os.path.join(base, "personaliz-assistant", "linkedin-profile")


# ---------------------------------------------------------------------------
# Core engine
# ---------------------------------------------------------------------------

class AgentEngine:
    def __init__(self, sandbox: bool = True, profile_dir: Optional[str] = None):
        self.sandbox = sandbox
        self.profile_dir = profile_dir or _default_profile_dir()
        self.logs: List[Dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Logging
    # ------------------------------------------------------------------

    def log(self, level: str, message: str):
        """Append a log entry and echo to stderr."""
        timestamp = datetime.now().isoformat()
        display = f"[SANDBOX] {message}" if self.sandbox else message
        entry = {"timestamp": timestamp, "level": level, "message": display}
        self.logs.append(entry)
        print(f"[{timestamp}] {level.upper()}: {display}", file=sys.stderr)

    # ------------------------------------------------------------------
    # Content generation helpers
    # ------------------------------------------------------------------

    def search_trending_topics(self) -> List[str]:
        self.log("info", "🔍 Searching for trending OpenClaw topics...")

        # Try to fetch from real RSS feeds / curated sources
        topics = self._fetch_topics_from_rss()
        if topics:
            self.log("success", f"✅ Fetched {len(topics)} live topics from feed")
            return topics

        # Fallback to curated hardcoded topics
        fallback_topics = [
            "How OpenClaw is revolutionizing RPA automation",
            "5 ways non-technical users can automate with OpenClaw",
            "OpenClaw + Desktop: The future of no-code automation",
            "Why OpenClaw is the easiest way to get started with browser automation",
            "Automating LinkedIn workflows with OpenClaw – a practical guide",
        ]
        self.log("info", f"ℹ️  Using {len(fallback_topics)} curated topics (no live feed available)")
        return fallback_topics

    def _fetch_topics_from_rss(self) -> List[str]:
        """Attempt to fetch trending automation/AI topics from public RSS feeds.

        Returns an empty list on failure so the caller can fall back gracefully.
        Only uses the stdlib (no requests dependency required).
        """
        import urllib.request
        import xml.etree.ElementTree as ET

        # Public RSS feeds related to automation/AI/no-code
        feeds = [
            "https://zapier.com/engineering/feeds/rss/",
            "https://medium.com/feed/tag/automation",
        ]
        topics: List[str] = []
        for feed_url in feeds:
            try:
                req = urllib.request.Request(
                    feed_url,
                    headers={"User-Agent": "personaliz-assistant/1.0"},
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = resp.read().decode("utf-8", errors="replace")
                root = ET.fromstring(data)
                ns = {"atom": "http://www.w3.org/2005/Atom"}
                # RSS <item><title> or Atom <entry><title>
                for item in root.iter("item"):
                    title = item.findtext("title", "").strip()
                    if title and len(title) > 10:
                        topics.append(title)
                    if len(topics) >= 5:
                        break
                for entry in root.iter("{http://www.w3.org/2005/Atom}entry"):
                    title_el = entry.find("{http://www.w3.org/2005/Atom}title")
                    if title_el is not None and title_el.text:
                        topics.append(title_el.text.strip())
                    if len(topics) >= 5:
                        break
                if topics:
                    break
            except Exception:
                continue
        return topics[:5]

    def generate_linkedin_posts(self, topics: List[str]) -> List[str]:
        self.log("info", "✍️ Generating LinkedIn posts...")
        posts = [
            (
                f"🚀 Just discovered something amazing: {topics[0]}\n\n"
                "OpenClaw is making automation accessible to everyone, not just developers. "
                "No coding required! 💡\n\n#OpenClaw #Automation #NoCode"
            ),
            (
                f"Excited to share: {topics[1]}\n\n"
                "If you've always wanted to automate repetitive tasks but didn't know how to code, "
                "OpenClaw is changing the game! 🎯\n\n#Automation #Desktop"
            ),
            (
                f"📌 Hot take: {topics[2]}\n\n"
                "Combining OpenClaw with desktop automation unlocks incredible possibilities "
                "for businesses of all sizes.\n\n#Innovation #RPA #Automation"
            ),
        ]
        self.log("success", f"✅ Generated {len(posts)} post options")
        return posts

    # ------------------------------------------------------------------
    # Browser context (persistent login session)
    # ------------------------------------------------------------------

    def _launch_context(self, playwright_instance):
        """Launch a persistent Chromium context so login is remembered.

        The browser profile is stored at ``self.profile_dir`` (default:
        ``~/.local/share/personaliz-assistant/linkedin-profile/`` on
        Linux/macOS; ``%APPDATA%\\personaliz-assistant\\linkedin-profile\\``
        on Windows).  Log in to LinkedIn once via the opened browser window;
        the session cookie is automatically reused on subsequent runs.
        """
        os.makedirs(self.profile_dir, exist_ok=True)
        self.log("info", f"📂 Using browser profile at: {self.profile_dir}")
        context = playwright_instance.chromium.launch_persistent_context(
            self.profile_dir,
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
            ignore_https_errors=True,
        )
        return context

    # ------------------------------------------------------------------
    # LinkedIn: post to feed
    # ------------------------------------------------------------------

    def post_to_linkedin_browser(self, content: str) -> bool:
        """Post content to the LinkedIn feed via browser automation."""
        if self.sandbox:
            self.log("info", f"[SANDBOX] Would post to LinkedIn:\n\"{content[:120]}...\"")
            return True

        if not PLAYWRIGHT_AVAILABLE:
            self.log("error", "❌ Playwright not installed. Run: pip install playwright && playwright install chromium")
            return False

        try:
            self.log("info", "🌐 Launching browser (persistent session)...")
            with sync_playwright() as pw:
                ctx = self._launch_context(pw)
                page = ctx.pages[0] if ctx.pages else ctx.new_page()

                self.log("info", "📍 Navigating to LinkedIn feed...")
                page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(3000)

                # Detect login wall
                if "login" in page.url or "signup" in page.url:
                    self.log("warning", "⚠️  Not logged in. Browser will open – please log in and re-run.")
                    page.wait_for_timeout(60000)
                    ctx.close()
                    return False

                # Open post composer
                self.log("info", "✍️ Opening post composer...")
                # Try multiple known selectors for the "Start a post" button
                # (LinkedIn periodically changes class names and ARIA labels)
                composer_selectors = [
                    "button:has-text('Start a post')",
                    "[aria-label='Start a post']",
                    "[aria-label='Create a post']",
                    ".share-box-feed-entry__trigger",
                    ".share-creation-state__trigger",
                    "button.share-box__open",
                    "[data-control-name='share.open_create_modal_trigger']",
                    "div.share-box-feed-entry__top-bar button",
                ]
                clicked = False
                for selector in composer_selectors:
                    try:
                        btn = page.locator(selector).first
                        if btn.count() > 0:
                            btn.scroll_into_view_if_needed()
                            btn.click(timeout=5000)
                            clicked = True
                            self.log("info", f"✅ Opened composer via selector: {selector}")
                            break
                    except Exception:
                        continue

                if not clicked:
                    # Last resort: wait a bit more and retry the primary selectors
                    self.log("info", "⏳ Composer button not found yet, waiting 5 s and retrying…")
                    page.wait_for_timeout(5000)
                    for selector in composer_selectors[:4]:
                        try:
                            btn = page.locator(selector).first
                            if btn.count() > 0:
                                btn.scroll_into_view_if_needed()
                                btn.click(timeout=8000)
                                clicked = True
                                self.log("info", f"✅ Opened composer via selector: {selector}")
                                break
                        except Exception:
                            continue

                if not clicked:
                    raise TimeoutError(
                        "Could not find the 'Start a post' button on LinkedIn.\n"
                        "The LinkedIn UI may have changed, or the page is not fully loaded.\n"
                        "Tip: Open the browser profile manually, log in, and verify you see the feed."
                    )
                page.wait_for_timeout(1500)

                # Type content into editor
                self.log("info", "📝 Typing post content...")
                editor = page.locator(
                    ".ql-editor, "
                    "[data-placeholder='What do you want to talk about?'], "
                    "[contenteditable='true']"
                ).first
                editor.click()
                editor.type(content, delay=20)
                page.wait_for_timeout(1000)

                # Submit post
                self.log("info", "📤 Submitting post...")
                post_btn = page.locator(
                    "button.share-actions__primary-action, "
                    "button:has-text('Post')"
                ).last
                post_btn.click(timeout=10000)
                page.wait_for_timeout(3000)

                self.log("success", "✅ Post published successfully!")
                ctx.close()
                return True

        except Exception as exc:
            self.log("error", f"❌ Failed to post: {exc}")
            return False

    # ------------------------------------------------------------------
    # LinkedIn: comment on hashtag posts
    # ------------------------------------------------------------------

    def comment_on_hashtag_posts(
        self,
        hashtag: str = "openclaw",
        comment_text: str = "",
        max_posts: int = 3,
    ) -> int:
        """Search LinkedIn for #hashtag and comment on the top posts."""
        if not comment_text:
            comment_text = (
                "🎯 Check out Personaliz – it makes OpenClaw automation accessible to everyone, "
                "no coding needed! https://github.com/goldDgokul/personaliz-ai-assistant "
                "#OpenClaw #Automation"
            )

        if self.sandbox:
            self.log("info", f"[SANDBOX] Would search #​{hashtag} and comment on up to {max_posts} posts.")
            self.log("info", f"[SANDBOX] Comment text: {comment_text[:100]}...")
            return max_posts

        if not PLAYWRIGHT_AVAILABLE:
            self.log("error", "❌ Playwright not installed.")
            return 0

        commented = 0
        try:
            self.log("info", f"🌐 Launching browser to search #{hashtag}...")
            with sync_playwright() as pw:
                ctx = self._launch_context(pw)
                page = ctx.pages[0] if ctx.pages else ctx.new_page()

                hashtag_url = f"https://www.linkedin.com/feed/hashtag/{hashtag.lower().lstrip('#')}/"
                self.log("info", f"📍 Navigating to {hashtag_url}...")
                page.goto(hashtag_url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(3000)

                if "login" in page.url or "signup" in page.url:
                    self.log("warning", "⚠️  Not logged in. Please log in and re-run.")
                    page.wait_for_timeout(60000)
                    ctx.close()
                    return 0

                # Gather comment buttons from the feed
                self.log("info", "🔍 Looking for posts in the feed...")
                comment_buttons = page.locator(
                    "button[aria-label*='comment' i], "
                    "button.comment-button, "
                    ".social-actions button:has-text('Comment')"
                )
                count = comment_buttons.count()
                self.log("info", f"Found {count} potential comment buttons")

                for i in range(min(count, max_posts)):
                    try:
                        btn = comment_buttons.nth(i)
                        btn.scroll_into_view_if_needed()
                        btn.click(timeout=8000)
                        page.wait_for_timeout(1500)

                        # Type comment in the reply box
                        reply_box = page.locator(
                            ".ql-editor, [contenteditable='true'][data-placeholder*='comment' i]"
                        ).last
                        reply_box.click()
                        reply_box.type(comment_text, delay=15)
                        page.wait_for_timeout(800)

                        # Submit comment
                        submit = page.locator(
                            "button.comments-comment-box__submit-button, "
                            "button:has-text('Post comment')"
                        ).last
                        submit.click(timeout=8000)
                        page.wait_for_timeout(2000)

                        commented += 1
                        self.log("success", f"✅ Commented on post {i + 1}")
                    except Exception as exc:
                        self.log("warning", f"⚠️  Could not comment on post {i + 1}: {exc}")

                ctx.close()
        except Exception as exc:
            self.log("error", f"❌ Hashtag agent failed: {exc}")

        return commented

    # ------------------------------------------------------------------
    # High-level agent runners
    # ------------------------------------------------------------------

    def run_linkedin_trending_agent(self, approved: bool = False) -> Dict[str, Any]:
        self.log("info", "🚀 Starting LinkedIn Trending Agent...")
        try:
            topics = self.search_trending_topics()
            posts = self.generate_linkedin_posts(topics)

            if posts:
                if self.sandbox:
                    self.log("info", f"[SANDBOX] Preview post:\n{posts[0][:200]}")
                    success = self.post_to_linkedin_browser(posts[0])
                else:
                    # Production: require explicit approval flag to prevent accidental posts
                    if not approved:
                        self.log("warning", "⚠️  Production mode requires human approval before posting.")
                        return {
                            "status": "pending_approval",
                            "message": "Approval required before posting in production mode.",
                            "logs": self.logs,
                            "content": posts[0],
                        }
                    success = self.post_to_linkedin_browser(posts[0])

                if success:
                    return {
                        "status": "success",
                        "message": "✅ LinkedIn Trending Agent completed. Posted to LinkedIn.",
                        "logs": self.logs,
                        "posted": 1,
                        "content": posts[0],
                    }

            return {
                "status": "completed",
                "message": "✅ Agent execution completed (nothing to post)",
                "logs": self.logs,
                "posted": 0,
            }

        except Exception as exc:
            self.log("error", f"❌ Agent failed: {exc}")
            return {"status": "error", "message": str(exc), "logs": self.logs}

    def run_hashtag_comment_agent(
        self,
        hashtag: str = "openclaw",
        comment: str = "",
    ) -> Dict[str, Any]:
        self.log("info", "🚀 Starting Hashtag Comment Agent...")
        try:
            self.log("info", f"🔍 Searching for #{hashtag} posts on LinkedIn...")
            n = self.comment_on_hashtag_posts(hashtag=hashtag, comment_text=comment)
            return {
                "status": "success",
                "message": f"✅ Commented on {n} posts with #{hashtag}",
                "logs": self.logs,
                "comments_posted": n,
            }
        except Exception as exc:
            self.log("error", f"❌ Agent failed: {exc}")
            return {"status": "error", "message": str(exc), "logs": self.logs}


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agent_engine.py",
        description="Personaliz agent engine CLI",
    )
    sub = parser.add_subparsers(dest="command")

    # --- linkedin_post ---
    p_post = sub.add_parser("linkedin_post", help="Post to LinkedIn feed")
    p_post.add_argument("--content", required=True, help="Post content")
    p_post.add_argument("--sandbox", default="true", help="true|false")
    p_post.add_argument("--approved", default="false", help="true|false – approval confirmed")
    p_post.add_argument("--profile-dir", default=None)

    # --- linkedin_comment_hashtag ---
    p_comment = sub.add_parser("linkedin_comment_hashtag", help="Comment on hashtag posts")
    p_comment.add_argument("--hashtag", default="openclaw")
    p_comment.add_argument("--comment", default="")
    p_comment.add_argument("--sandbox", default="true")
    p_comment.add_argument("--profile-dir", default=None)

    # --- trending_topics ---
    sub.add_parser("trending_topics", help="Return trending topics as JSON")

    return parser


def _parse_bool(value: str) -> bool:
    return value.lower() not in ("false", "0", "no", "prod", "production")


def main():
    # -----------------------------------------------------------------------
    # Detect whether called with new subcommand style or legacy positional args
    # -----------------------------------------------------------------------
    known_subcommands = {"linkedin_post", "linkedin_comment_hashtag", "trending_topics"}
    use_legacy = len(sys.argv) < 2 or sys.argv[1] not in known_subcommands

    if use_legacy:
        # Legacy: agent_engine.py <agent_id> [sandbox|live]
        if len(sys.argv) < 2:
            print(json.dumps({"status": "error", "message": "No agent specified"}))
            return

        agent_id = sys.argv[1]
        sandbox = not (len(sys.argv) > 2 and sys.argv[2] in ("live", "prod", "production", "false"))
        engine = AgentEngine(sandbox=sandbox)

        if "linkedin" in agent_id.lower() or "trending" in agent_id.lower():
            result = engine.run_linkedin_trending_agent()
        elif "hashtag" in agent_id.lower() or "comment" in agent_id.lower():
            result = engine.run_hashtag_comment_agent()
        else:
            result = {
                "status": "success",
                "message": f"✅ Agent {agent_id} executed",
                "logs": engine.logs,
            }

        print(json.dumps(result))
        return

    # -----------------------------------------------------------------------
    # New subcommand-based interface
    # -----------------------------------------------------------------------
    parser = _build_parser()
    args = parser.parse_args()

    if args.command == "linkedin_post":
        sandbox = _parse_bool(args.sandbox)
        engine = AgentEngine(sandbox=sandbox, profile_dir=args.profile_dir)
        ok = engine.post_to_linkedin_browser(args.content)
        result = {
            "status": "success" if ok else "error",
            "message": "✅ Posted to LinkedIn" if ok else "❌ Post failed",
            "logs": engine.logs,
            "posted": 1 if ok else 0,
        }

    elif args.command == "linkedin_comment_hashtag":
        sandbox = _parse_bool(args.sandbox)
        engine = AgentEngine(sandbox=sandbox, profile_dir=args.profile_dir)
        result = engine.run_hashtag_comment_agent(
            hashtag=args.hashtag,
            comment=args.comment,
        )

    elif args.command == "trending_topics":
        engine = AgentEngine(sandbox=True)
        topics = engine.search_trending_topics()
        result = {"status": "success", "topics": topics, "logs": engine.logs}

    else:
        result = {"status": "error", "message": f"Unknown command: {args.command}"}

    print(json.dumps(result))


if __name__ == "__main__":
    main()