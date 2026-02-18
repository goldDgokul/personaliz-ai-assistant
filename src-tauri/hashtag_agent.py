# Finds the latest post under #AI and leaves a comment
def run_hashtag_agent(hashtag="AI"):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        page.goto(f"https://www.linkedin.com/search/results/content/?keywords=%23{hashtag}&origin=SWITCH_SEARCH_VERTICAL")
        
        # Wait for first post, click 'Comment', and type something AI-generated
        page.wait_for_selector(".comment-button")
        page.click(".comment-button")
        page.fill(".ql-editor", "This is an automated insight about #AI trends. Great post!")
        
        # page.keyboard.press("Enter") # For live action
        browser.close()