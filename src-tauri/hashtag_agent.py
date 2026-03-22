# Finds the latest post under #AI and leaves a comment
def run_hashtag_agent(hashtag="AI"):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        page.goto(
            f"https://www.linkedin.com/search/results/content/"
            f"?keywords=%23{hashtag}&origin=SWITCH_SEARCH_VERTICAL"
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
                    break
            except Exception:
                continue

        if not clicked:
            print(f"WARNING: Could not find a comment button for #{hashtag}")
            browser.close()
            return

        page.wait_for_timeout(1500)

        # Find and fill the comment editor
        reply_box_selectors = [
            ".comments-comment-box .ql-editor",
            ".comments-comment-texteditor .ql-editor",
            "[contenteditable='true'][data-placeholder*='Add a comment' i]",
            "[contenteditable='true'][data-placeholder*='comment' i]",
            ".ql-editor",
        ]
        for rsel in reply_box_selectors:
            try:
                editor = page.locator(rsel).last
                if editor.count() > 0:
                    editor.click()
                    editor.fill(f"This is an automated insight about #{hashtag} trends. Great post!")
                    break
            except Exception:
                continue

        # page.keyboard.press("Enter") # For live action
        browser.close()