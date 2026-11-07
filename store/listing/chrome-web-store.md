# Chrome Web Store listing draft — Bible Maps 1.0.2

Paste/adapt these fields in the Developer Dashboard.

## Short description (≤132 characters)

```
Highlight biblical places & journeys as you read—offline map in the side panel, works on major Bible sites.
```

(Character count: 112)

## Detailed description

```
Bible Maps highlights curated biblical places and journeys while you read Scripture in Chrome, then opens them in a side panel map—no account and no AI required.

What you get
• Soft green highlights on place names in the passage
• Side panel with Places and Journeys
• Offline map of the biblical Mediterranean–Near East corridor
• Optional online map fill when you pan outside that region (while online)
• Links to Google Maps for modern streets / walking directions

How to use
1. Install Bible Maps and pin it if you like
2. Open a supported Bible reading site and a chapter rich in places (for example Acts 13 or Genesis 12)
3. Wait a moment for highlights
4. Open the side panel from the extension icon (or click a highlighted place)

Privacy-minded: matching uses a local gazetteer shipped with the extension. The content script runs only on the Bible reader hosts declared in the extension permissions.
```

## Category

Education (or Reference / Productivity if Education is unavailable)

## Language

English

## Single purpose (store attestation)

```
This extension’s single purpose is to detect curated biblical place names and journeys in Scripture text on supported Bible websites and show them on a map in the Chrome side panel.
```

## Permission justifications (draft)

| Permission / host | Why |
|-------------------|-----|
| `sidePanel` | Show places, journeys, and the map beside the page |
| `storage` | Remember light UI preferences (e.g. theme) |
| `activeTab` / `tabs` | Open the side panel for the active Bible tab and refresh detections |
| Hosts: bible.com, biblegateway.com, biblia.com, blueletterbible.org, biblehub.com, biblestudytools.com | Run the content script that scans verse text and highlights places |
| Hosts: arcgisonline.com (Esri) | Optional online basemap tiles when the view leaves the offline extract |
| Hosts: google.com / gstatic / googleapis | Optional Google Maps links / related assets for modern directions |

## Host permission justification (dashboard field)

```
Bible Maps needs host access only for its single purpose: detect curated biblical place/journey names in Scripture on supported Bible reader sites and show them in the Chrome side panel map.

• Supported Bible reader hosts (including subdomains): run the content script that reads verse text on those pages, highlights matches, and sends place/journey lists to the side panel. The extension does not operate on other websites.

• arcgisonline.com (including server.arcgisonline.com / services.arcgisonline.com): optionally fetch public Esri canvas map tiles when the user pans outside the bundled offline map extract while online.

• google.com, googleapis.com, and gstatic.com: support optional “open in Google Maps” / directions links the user chooses from the side panel for modern-map context.
```

## Privacy policy blurb (host on your site; paste URL in dashboard)

Public URL: https://www.meritssllc.com/bible-maps-pp/

Short draft for a privacy page:

```
Bible Maps (Chrome extension) detects biblical place names locally in your browser using a curated gazetteer bundled with the extension. It does not create user accounts and does not send verse text to an AI service.

The extension can access page content only on the Bible reader sites listed in its permissions in order to highlight places and send place/journey lists to its own side panel.

When you are online and pan the map outside the bundled offline region, the map may request publicly available Esri canvas tiles. Optional Google Maps links open in your browser using Google’s services under Google’s terms.

No analytics SDK is bundled for the purpose of tracking reading habits. Contact: nst@meritssllc.com.
Hosted privacy policy: https://www.meritssllc.com/bible-maps-pp/
```

## Resubmission note (Yellow Argon — Nov 2, 2026)

Rejected for a “WHERE IT WORKS” bullet list of site brand names treated as excessive keywords. The detailed description above removes that list; name supported hosts only in permissions / reviewer notes / privacy policy as needed.
