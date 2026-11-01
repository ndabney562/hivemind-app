# HiveMind Phone Shortcut (build by hand)

When the Mac doesn't answer, the HiveMind app on the iPhone asks the person's own AIs through one Shortcut named
**HiveMind Phone**. The app opens it with `shortcuts://x-callback-url/run-shortcut?name=HiveMind%20Phone&input=text&text=…`
and Shortcuts sends the answer back to the app (`#cb=ok&result=…`, or `#cb=err&errorMessage=…`).

Build it once per phone; it only uses apps the person is already signed in to.

## Contract

- **Input** (Shortcut Input, text): JSON `{"prompt": "...", "order": ["claude-app", "apple-cloud", ...]}`.
  `prompt` is the full question (About you and recent turns already added by the app). `order` lists the AIs to try,
  best first, and only ones the person ticked under Settings › Your AIs.
- **Output** (Stop and Output, a Dictionary, which Shortcuts sends as JSON text):
  `{"model": "<id>", "ok": true|false, "answer": "<text>"}`. `model` is the id that answered (or the last one tried).

## AI ids and the action each one uses

| id | action |
|---|---|
| `apple-local` | Apple Intelligence **Use Model**, model **On-Device** |
| `apple-cloud` | Apple Intelligence **Use Model**, model **Private Cloud Compute** |
| `claude-app` | Claude app **Ask Claude** (needs the Claude app, signed in) |
| `chatgpt-app` | ChatGPT app **Ask ChatGPT** (needs the ChatGPT app, signed in) |

## Steps

1. New Shortcut, name it exactly `HiveMind Phone`. In its details, leave **Show in Share Sheet** off; it receives **Text**.
2. **Get Dictionary from** Shortcut Input.
3. **Get Dictionary Value** for key `prompt` → **Set Variable** `Prompt`.
4. **Get Dictionary Value** for key `order` → **Repeat with Each** item:
   1. **If** `Answer` **does not have any value** (Shortcuts has no "break", so this check is how it can stop at the first non-empty answer):
      1. **Set Variable** `Model` to Repeat Item.
      2. **If** Repeat Item **is** `apple-local` → **Use Model** (On-Device) with `Prompt` → **Set Variable** `Answer`.
      3. **If** Repeat Item **is** `apple-cloud` → **Use Model** (Private Cloud Compute) with `Prompt` → **Set Variable** `Answer`.
      4. **If** Repeat Item **is** `claude-app` → **Ask Claude** with `Prompt` → **Set Variable** `Answer`.
      5. **If** Repeat Item **is** `chatgpt-app` → **Ask ChatGPT** with `Prompt` → **Set Variable** `Answer`.
   2. End If.
5. After the loop: **If** `Answer` **has any value** → **Dictionary** `model` = `Model`, `ok` = true (Boolean), `answer` = `Answer`.
   **Otherwise** → **Dictionary** `model` = `Model`, `ok` = false, `answer` = `No AI on this phone answered`.
6. **Stop and Output** the Dictionary.

Leave out a branch for an app the phone doesn't have. If a branch's app is missing or signed out, its action fails or
returns nothing, and the loop moves on to the next id.

## Check it

On the iPhone, open HiveMind with the Mac off (or Tailscale off), tick your AIs under Settings › Your AIs, and ask
"define osmosis". Shortcuts opens, answers, and returns to HiveMind with the answer tagged "phone only, not checked".
