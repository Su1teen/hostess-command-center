# XOXO photography

Brand photographs from the user's `C:/hostess/src/images-bar-xoxo` folder are served from `public/image/xoxo-exchange`. Source filenames are retained, including the original spellings; name and slug aliases live in the photo resolver.

`bacardi.jpeg` depicts light Bacardi and is not used for Bacardi Black. `bacardi-black.webp` is the separate Black bottle from [Bacardi's official product page](https://www.bacardi.com/us/en/our-rums/black-rum/), downloaded from its [product photograph](https://d323g1xugy1rkz.cloudfront.net/wp-content/uploads/sites/25/2020/08/21154630/Products-Bottle-Black-min.png). Empty transparent margins were trimmed for the card layout.

`vodka-serving.webp`, `amber-serving.webp`, and `bar-sharing.webp` are generated editorial serving photographs for categories without an exact photograph. They do not depict specific brands. Generated originals are retained outside the repository; the web assets are compressed for the menu.

Exact brand matches take priority over stale exchange image URLs. Existing dish images remain authoritative. Broken remote images fall back to an appropriate serving image before a neutral icon is shown. The frontend accepts HTTPS and same-origin absolute image paths, rejecting protocol-relative and executable URLs.
