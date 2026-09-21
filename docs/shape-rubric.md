# Shape Rubric

How Open_Mouse assigns the eight shape descriptors to a mouse **from first-party
sources only** — published dimensions plus the manufacturer's own product
renders. This rubric is the reason we never need to ship anyone else's editorial
judgments.

Owner: Claude. Consumed by: M1 (classification), M4a (Blender generation).

---

## Three classes of descriptor

| Class | Descriptors | Method |
|---|---|---|
| **Computed** | Size | Arithmetic from L/W/H. No vision. |
| **Constrained** | Shape, Hand compatibility, Thumb rest, Ring finger rest | Vision, but bounded by hard consistency rules below |
| **Visual** | Hump placement, Front flare, Side curvature | Vision only — no numeric proxy exists |

That last row is the crux. Measured on the validation fixture, height/length
medians across the four hump levels span just **0.320–0.336**, and width/length
across the seven flare levels is equally flat. There is no arithmetic shortcut
and no fallback. These three fields are where M1 will be won or lost.

---

## 1. Size — computed, do not classify

```
size_score = Length + 0.4 × (Width − 64)

Fingertip   if Length ≤ 104 mm and Height/Length ≤ 0.38
Small       if size_score <  117
Medium      if size_score ≤  124
Large       otherwise
```

**Measured against the validation fixture: 91.5% exact (n=1260), 99.8%
within-one-level; 89.5% exact on the Logitech subset (n=76).**

Fingertip is a *profile* category, not merely a short mouse — it needs both a
short body and a low deck, which is why the height ratio gates it.

Caveat for Codex: these five constants were fit on the full fixture with no
held-out split. The Logitech figure is the honest generalisation check. If you
extend to other brands and accuracy drops below ~85%, re-fit rather than
assuming the constants are universal — and record the new numbers in
`docs/STATUS.md`.

## 2. Hard consistency rules

Derived from the fixture and true with ≥99% regularity. **Enforce these as
validation, not suggestions** — a classification that violates one is a bug.

- `Hand compatibility = Ambidextrous` ⟹ `Shape = Symmetrical`. (Held for 76/76.)
- `Thumb rest = Yes` ⟹ `Shape = Ergonomic`. (126 of 127.) A symmetrical mouse
  with a claimed thumb rest is almost certainly a misclassification.
- `Ring finger rest = Yes` ⟹ `Shape = Ergonomic`.
- Ergonomic shells are handed: `Hand compatibility ∈ {Right, Left}`, never
  Ambidextrous.

## 3. Shape

- **Symmetrical** — left and right profiles mirror. Thumb and ring-finger sides
  are interchangeable.
- **Ergonomic** — deliberately handed: a thumb scoop, a canted deck, or an
  asymmetric hump.
- **Hybrid** — symmetrical in plan view but with mild asymmetric relief, e.g. a
  slight thumb-side scallop on an otherwise mirrored shell. Rare (~1.5%);
  prefer Symmetrical or Ergonomic unless the asymmetry is obvious but minor.

## 4. Hump placement — *visual*

**Definition: the position of peak shell height along the body, as a fraction of
total length, measured from the front.**

| Level | Peak position |
|---|---|
| Center | ≤ 0.55 |
| Back – minimal | 0.55 – 0.62 |
| Back – moderate | 0.62 – 0.70 |
| Back – aggressive | > 0.70 |

Judge from a **square-on side render**. Find the highest point of the top
shell, drop a perpendicular to the base line, and express its distance from the
front edge as a fraction of total length. Ignore the scroll wheel and any
buttons that break the silhouette — the *shell* is what the palm rests on.

## 5. Front flare — *visual*

**Definition: how the sidewalls behave forward of the widest point — do they
splay outward toward the click surface, run parallel, or tuck inward?**

Judge from a **top-down render**. Compare the width at the front third against
the width at the waist.

| Level | Behaviour |
|---|---|
| Inward – aggressive / moderate / slight | Nose pinches in; front noticeably narrower |
| Flat | Sidewalls run essentially parallel forward |
| Outward – slight / moderate / aggressive | Nose splays out toward the buttons |

Note the real-world distribution is lopsided: *Outward-slight*, *Outward-moderate*
and *Flat* together account for ~88% of mice, and *Inward-aggressive* is under 1%.
**Bias toward the common classes.** Reach for a tail label only on clear evidence
— an unprompted classifier will over-predict the extremes.

## 6. Side curvature — *visual*

**Definition: the cross-section profile of the sidewalls between deck and base.**

| Level | Behaviour |
|---|---|
| Inward – aggressive | Deeply concave; pronounced grip channel |
| Inward | Gently concave — the most common case |
| Flat | Near-vertical walls |
| Outward / Outward – aggressive | Convex, bulging walls. Rare (~1%) |

Judge from a **front or rear render**. Inward and Flat cover ~96% of mice; the
same anti-tail bias as flare applies.

## 7. Thumb rest / Ring finger rest

Boolean. A *rest* is a deliberate shelf or scoop that supports the digit — not
merely a concave sidewall (that is Side curvature). If a symmetrical mouse seems
to have one, re-read rule 2: it is almost certainly Side curvature being
misread.

---

## Applying the rubric

**Inputs:** the manufacturer's own product renders — ideally square-on side,
top-down, and front — plus published L/W/H/weight.

**Procedure:**
1. Compute `Size` arithmetically. Never ask a model for it.
2. Classify `Shape` and `Hand compatibility` first; they constrain everything else.
3. Classify the three visual descriptors, each from its designated view.
4. Run the rule-2 consistency checks. A violation means reclassify, not override.
5. Record `source_url` for every render used.

**Prompting notes for M1:** one descriptor per call with only the relevant view
attached — accuracy degrades when a model is asked to produce all eight at once.
Use structured output with the level names as a closed enum. State the
distribution priors from §5 and §6 in the prompt; they measurably reduce
tail over-prediction.

## Validating the rubric

`scripts/validate-rubric.ts` reads the private fixture from `../Dataset/`,
compares our classifications for the 76 Logitech models, and reports per-descriptor
agreement. **It must never run in CI** and its input must never enter the repo.

Report, per descriptor: exact agreement, within-one-level agreement, and the
confusion matrix. Confusions concentrated on adjacent levels mean the rubric is
sound and the boundaries need nudging. Confusions that jump two or more levels
mean the *definition* is wrong — fix the definition, not the boundary.

See `docs/STATUS.md` for the current gate thresholds and results.
