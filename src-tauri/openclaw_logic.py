import sys
import time
from playwright.sync_api import sync_playwright

# Pixels to scroll per pass when loading lazy-loaded feed content.
_SCROLL_AMOUNT_PX = 900
# Milliseconds to wait after each scroll pass (allows network + DOM to settle).
_SCROLL_WAIT_MS = 2000


def execute_browser_task(mode, content, task_type):
    """Core engine to handle LinkedIn automation"""
    with sync_playwright() as p:
        # Launch browser - headless=False is better for your demo!
        browser = p.chromium.launch(headless=False)
        # Suggestion: Use a persistent context to stay logged in
        context = browser.new_context()
        page = context.new_page()

        try:
            if "trending" in task_type:
                print(f"[{mode}] Navigating to LinkedIn Feed...")
                page.goto("https://www.linkedin.com/feed/")

                # Wait for the post box trigger
                page.wait_for_selector("button.share-mbw-transition__btn")
                page.click("button.share-mbw-transition__btn")

                # Fill the approved content
                page.wait_for_selector(".ql-editor")
                page.fill(".ql-editor", content)

                if mode == "PRODUCTION":
                    # page.click(".share-actions__primary-action") # Uncomment for live
                    print("PRODUCTION: Post submitted.")
                else:
                    print(f"SANDBOX: Content typed but not submitted: {content}")

            elif "hashtag" in task_type:
                print(f"[{mode}] Searching #OpenClaw posts (Posts tab)...")
                page.goto(
                    "https://www.linkedin.com/search/results/content/"
                    "?keywords=%23OpenClaw&origin=SWITCH_SEARCH_VERTICAL"
                )
                page.wait_for_timeout(3000)
                print(f"[{mode}] Page URL: {page.url!r} | Title: {page.title()!r}")

                # Check for login wall or rate-limit challenge
                if "login" in page.url or "signup" in page.url:
                    print(f"[{mode}] WARNING: Not logged in. Open the browser, log in, then re-run.")
                elif any(ind in page.url.lower() for ind in ("challenge", "checkpoint", "captcha")):
                    print(f"[{mode}] WARNING: LinkedIn rate-limit/challenge page detected: {page.url!r}")
                elif "search/results/all" in page.url or "search/results/content" not in page.url:
                    print(
                        f"[{mode}] WARNING: Expected Posts-only page (search/results/content/) "
                        f"but got: {page.url!r}. "
                        "LinkedIn may have redirected to general 'All' results — no commentable posts will be found."
                    )
                else:
                    # Scroll to trigger lazy-loaded posts (5 passes for reliability)
                    for scroll_pass in range(5):
                        page.evaluate(f"window.scrollBy(0, {_SCROLL_AMOUNT_PX})")
                        page.wait_for_timeout(_SCROLL_WAIT_MS)

                    # Try multiple known comment-button selectors (LinkedIn changes these periodically)
                    comment_btn_selectors = [
                        # ARIA-label based — most stable
                        "button[aria-label*='Comment' i]",
                        # 2024/2025 artdeco components
                        ".artdeco-button[aria-label*='Comment' i]",
                        "button[aria-label='Comment on this post']",
                        "button[aria-label='Comment']",
                        # Data control name
                        "button[data-control-name='comment']",
                        # Class-based
                        "button.comment-button",
                        ".social-action-bar__action-btn--comment",
                        ".social-actions button:has-text('Comment')",
                        ".social-action-bar button:has-text('Comment')",
                        # SVG icon-based
                        "button:has(svg[data-test-icon='comment-medium'])",
                        # Broad fallback
                        "button:has-text('Comment')",
                    ]
                    clicked = False
                    for sel in comment_btn_selectors:
                        try:
                            btn = page.locator(sel).first
                            # .count() avoids waiting for the full timeout on non-matching selectors
                            if btn.count() > 0:
                                btn.scroll_into_view_if_needed()
                                btn.click(timeout=5000)
                                clicked = True
                                print(f"[{mode}] Clicked comment button via selector: {sel!r}")
                                break
                        except Exception:
                            continue

                    if not clicked:
                        # Log diagnostics so user can debug.
                        # On search/results/content/ (Posts tab) LinkedIn wraps results in
                        # 'reusable-search__result-container'; on the hashtag feed it uses
                        # 'feed-shared-update-v2'.  We check both for useful diagnostics.
                        for pc_sel in (
                            "li.reusable-search__result-container",
                            ".reusable-search__result-container",
                            ".feed-shared-update-v2",
                            "div[data-urn]",
                            ".entity-result",
                            "article",
                        ):
                            n = page.locator(pc_sel).count()
                            if n > 0:
                                print(
                                    f"[{mode}] WARNING: Found {n} post containers via {pc_sel!r} "
                                    "but no comment buttons matched — LinkedIn UI may have changed."
                                )
                                break
                        else:
                            print(
                                f"[{mode}] WARNING: No post containers or comment buttons found. "
                                f"URL: {page.url!r} | Title: {page.title()!r}. "
                                "Possible causes: (1) not logged in, (2) empty hashtag, "
                                "(3) LinkedIn UI change, (4) wrong results page loaded."
                            )
                    else:
                        page.wait_for_timeout(2000)
                        # Find the comment editor
                        reply_box_selectors = [
                            ".comments-comment-box .ql-editor",
                            ".comments-comment-texteditor .ql-editor",
                            ".comments-comment-box [contenteditable='true']",
                            # 2024/2025 editor
                            "div.editor-content[contenteditable='true']",
                            "[contenteditable='true'][role='textbox']",
                            "[contenteditable='true'][data-placeholder*='Add a comment' i]",
                            "[contenteditable='true'][data-placeholder*='comment' i]",
                            ".ql-editor",
                            "[contenteditable='true']",
                        ]
                        typed = False
                        for rsel in reply_box_selectors:
                            try:
                                editor = page.locator(rsel).last
                                if editor.count() > 0:
                                    editor.scroll_into_view_if_needed()
                                    editor.click(force=True)
                                    page.wait_for_timeout(500)
                                    # Prefer fill(); fall back to keyboard.type()
                                    try:
                                        editor.fill(content)
                                    except Exception:
                                        editor.press("Control+a")
                                        page.keyboard.type(content, delay=15)
                                    typed = True
                                    print(f"[{mode}] Comment typed via selector: {rsel!r}")
                                    break
                            except Exception:
                                continue

                        if typed:
                            print(f"[{mode}] Comment prepared.")
                        else:
                            print(f"[{mode}] WARNING: Could not find the comment editor.")

            time.sleep(5)  # Keep open for demo visibility
        except Exception as e:
            print(f"Error during execution: {e}")
        finally:
            browser.close()


if __name__ == "__main__":
    # Expecting: [task_type, mode, approved_content]
    task = sys.argv[1].lower()
    run_mode = sys.argv[2].upper()
    # The content passed back from your React Approval Modal
    final_content = sys.argv[3] if len(sys.argv) > 3 else "Default OpenClaw Content"

    execute_browser_task(run_mode, final_content, task)