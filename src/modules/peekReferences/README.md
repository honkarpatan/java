# Peek References module

VS Code style **Go to References** popup for Acode (CodeMirror 6). Self-contained: no CSS
import, no top-level `acode` use — copy the folder into any plugin (C++, PHP, …).

```js
import { createPeekReferences, JAVA_PROFILE } from './modules/peekReferences';

const peek = createPeekReferences({
  profile: JAVA_PROFILE,            // 'java' | 'cpp' | 'php' | 'javascript' | custom profile object
  getDirLabel: (file) => '~/',      // optional text after the file name in the header
  messages: { references: 'References' },
});
peek.show();      // symbol under cursor / selected identifier
peek.hide();
peek.isOpen();
peek.dispose();   // on plugin unload (removes listener + injected CSS)
```

## What the popup does
- Header: file name, directory, `- References (n)`, close (X). Android back button / Esc also close.
- Left: editable CM6 editor (same language + syntax colours + theme classes as the main editor).
- Right: one row per reference, the matched part highlighted. Tap = select, double tap / Enter = go to.
- Editing in the popup updates the main editor immediately (and vice-versa); hits stay highlighted
  and the list/count refresh while typing.
- Follows the editor theme (measured colours, copied theme classes) and the app theme (Acode CSS vars).
- Drag the vertical sash to resize the list, the bottom handle to resize the popup.

## New language
```js
import { createProfile } from './modules/peekReferences';
const KOTLIN = createProfile({ id: 'kotlin', keywords: ['fun', 'val', 'var'] });
createPeekReferences({ profile: KOTLIN });
```
A profile only tells the scanner what is a comment / string / identifier.

## Limits
References are lexical (token based, comment/string aware), not semantic, and single-file.
Requires the CM6 editor and `acode.require('@codemirror/view' | 'state')` (`language`/`commands` optional).
