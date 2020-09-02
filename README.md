# roon-discord-publish
Uses the Discord Presence API to show what you're listening to on Roon. Edit the `settings` object in the main `.js` file to suit your configuration.

Based on an [implementation](https://github.com/jamesxsc/roon-discord-rp) by 615283 (James Conway). Changes:
- significantly improve use of javascript paradigms / language age
- allow for use of a particular core instead of using discovery
- extract settings functionality, as this tends to crash roon
- don't publish a presence if roon is not being actively used
- auto shutdown
- block on Discord connection on startup
- some rate limiting
- remove electron dependency, among others
