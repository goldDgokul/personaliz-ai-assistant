# Finds the latest posts under a hashtag and leaves a comment on each.
# Updated selectors and diagnostics for LinkedIn 2024/2025 UI.

# Pixels to scroll per pass when loading lazy-loaded feed content.
_SCROLL_AMOUNT_PX = 900
# Milliseconds to wait after each scroll pass (allows network + DOM to settle).
_SCROLL_WAIT_MS = 2000


def run_hashtag_agent(hashtag="AI"):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()

        # Try the dedicated hashtag feed first, then fall back to search results.
        primary_url = (
            f"https://www.linkedin.com/feed/hashtag/{hashtag.lower().lstrip('#')}/"
        )
        print(f"[hashtag_agent] Navigating to: {primary_url}")
        page.goto(primary_url)
        page.wait_for_timeout(3000)
        print(f"[hashtag_agent] Page URL after navigation: {page.url!r}")

        # If not logged in, bail out with a clear message.
        if "login" in page.url or "signup" in page.url:
            print(
                "[hashtag_agent] WARNING: Not logged in. "
                "Open the browser, log in to LinkedIn, then re-run."
            )
            browser.close()
            return

        # Rate-limit / challenge detection
        block_indicators = ["challenge", "checkpoint", "captcha", "authwall"]
        if any(ind in page.url.lower() for ind in block_indicators):
            print(
                f"[hashtag_agent] WARNING: LinkedIn security/rate-limit page detected. "
                f"URL: {page.url!r}. Wait a few minutes and re-run."
            )
            browser.close()
            return

        # Fall back to content-search URL (more reliable for low-volume hashtags)
        search_url = (
            f"https://www.linkedin.com/search/results/content/"
            f"?keywords=%23{hashtag.lower().lstrip('#')}&origin=SWITCH_SEARCH_VERTICAL"
        )
        print(f"[hashtag_agent] Also trying search URL: {search_url}")
        page.goto(search_url)
        page.wait_for_timeout(3000)
        print(f"[hashtag_agent] Page URL: {page.url!r} | Title: {page.title()!r}")

        if "login" in page.url or "signup" in page.url:
            print(
                "[hashtag_agent] WARNING: Not logged in. "
                "Open the browser, log in to LinkedIn, then re-run."
            )
            browser.close()
            return

        # Scroll to trigger lazy-loaded posts (LinkedIn doesn't render posts
        # until they are scrolled into the viewport).
        print("[hashtag_agent] Scrolling to load posts…")
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
            ".feed-shared-social-action-bar__action-button[aria-label*='comment' i]",
            "li.social-action-button--comment button",
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
                    print(f"[hashtag_agent] Clicked comment button via selector: {sel!r}")
                    break
            except Exception:
                continue

        if not clicked:
            # Log what is on the page for diagnostics
            post_containers = [
                ".feed-shared-update-v2",
                "div[data-urn]",
                ".entity-result",
                "article",
            ]
            found_container = False
            for pc_sel in post_containers:
                n = page.locator(pc_sel).count()
                if n > 0:
                    print(
                        f"[hashtag_agent] INFO: Found {n} post containers via {pc_sel!r} "
                        "but no comment buttons matched — LinkedIn UI may have changed."
                    )
                    found_container = True
                    break
            if not found_container:
                print(
                    f"[hashtag_agent] WARNING: No post containers or comment buttons found. "
                    f"URL: {page.url!r} | Title: {page.title()!r}. "
                    "Possible causes: not logged in, empty hashtag, or LinkedIn UI change."
                )
            browser.close()
            return

        page.wait_for_timeout(2000)

        # Find and fill the comment editor
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
                    comment_text = (
                        f"This is an automated insight about #{hashtag} trends. Great post!"
                    )
                    # Prefer fill(); fall back to keyboard.type()
                    try:
                        editor.fill(comment_text)
                    except Exception:
                        editor.press("Control+a")
                        page.keyboard.type(comment_text, delay=15)
                    typed = True
                    print(f"[hashtag_agent] Comment typed via selector: {rsel!r}")
                    break
            except Exception:
                continue

        if not typed:
            print(
                "[hashtag_agent] WARNING: Could not find the comment editor. "
                "All reply-box selectors exhausted."
            )

        # page.keyboard.press("Enter")  # Uncomment for live submission
        browser.close()