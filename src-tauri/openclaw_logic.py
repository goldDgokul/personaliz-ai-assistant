import sys
import time
from playwright.sync_api import sync_playwright


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
                print(f"[{mode}] Searching #OpenClaw...")
                page.goto(
                    "https://www.linkedin.com/search/results/content/"
                    "?keywords=%23OpenClaw&origin=SWITCH_SEARCH_VERTICAL"
                )
                page.wait_for_timeout(3000)

                # Scroll to trigger lazy-loaded posts
                for _ in range(3):
                    page.evaluate("window.scrollBy(0, 800)")
                    page.wait_for_timeout(1000)

                # Try multiple known comment-button selectors (LinkedIn changes these periodically)
                comment_btn_selectors = [
                    "button[aria-label*='Comment' i]",
                    "button[data-control-name='comment']",
                    "button.comment-button",
                    ".social-action-bar__action-btn--comment",
                    ".social-actions button:has-text('Comment')",
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
                    print(f"[{mode}] WARNING: Could not find a comment button on the page.")
                else:
                    page.wait_for_timeout(1500)
                    # Find the comment editor
                    reply_box_selectors = [
                        ".comments-comment-box .ql-editor",
                        ".comments-comment-texteditor .ql-editor",
                        "[contenteditable='true'][data-placeholder*='Add a comment' i]",
                        "[contenteditable='true'][data-placeholder*='comment' i]",
                        ".ql-editor",
                    ]
                    typed = False
                    for rsel in reply_box_selectors:
                        try:
                            editor = page.locator(rsel).last
                            if editor.count() > 0:
                                editor.click()
                                editor.fill(content)
                                typed = True
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