# Frameworks

One file per framework version: `frameworks/<slug>-v<version>.yaml`. A framework is an
attributed, opt-in lens: the author states their orientation, and each rule names the
exact vote and the position the author considers aligned. Results always show
"aligned X of Y" with the votes used; nothing here is a default view.

- `slug` + `version` are unique. Change rules by adding a new version file.
- `rules[].target`: a rollcall (`congress`, `chamber`, `number`) or a bill
  (`congress`, `bill_type`, `number`; scored on its final-passage rollcalls).
- `aligned_position`: `yea | nay`. `weight` defaults to 1. `rationale` is required.

```yaml
schema_version: 1
slug: example-framework
version: 1
title: Example Framework
author: Example Author
stated_orientation: example orientation
description: Placeholder showing the file shape.
methodology_url: https://example.org/placeholder/method
rules:
  - target:
      kind: rollcall
      congress: 119
      chamber: house
      number: 1
    aligned_position: yea
    rationale: Placeholder rationale.
  - target:
      kind: bill
      congress: 119
      bill_type: s
      number: 1
    aligned_position: nay
    weight: 2
    rationale: Placeholder rationale.
```
