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
                page.goto("https://www.linkedin.com/search/results/content/?keywords=%23OpenClaw")

                # Logic to find the first comment button
                page.wait_for_selector(".comment-button")
                page.click(".comment-button")
                page.fill(".ql-editor", content)
                print(f"[{mode}] Comment prepared.")

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