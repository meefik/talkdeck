---
marp: true
theme: modern
paginate: true
title: Modern Deck — a tour of the slide types
description: A neutral showcase of every slide type in the modern theme
author: Your Name
header: Modern Deck
footer: Your Name · Month 2026
---

<!-- _class: lead -->
<!-- _paginate: false -->
<!-- _header: "" -->
<!-- _footer: "" -->

# Modern Deck

## A tour of the slide types

Your Name · Month 2026


<!-- Hi everyone, -->
<!-- This deck is both a template and a showcase. -->
<!-- Every slide shows one layout you can copy into your own presentation. -->
<!-- Let me start with the agenda. -->
---

<!-- _class: invert -->

## Agenda

::: agenda

1. **Basics** — lists and reveals
2. **Layouts** — columns, cards, tables, images
3. **Process** — quotes, comparisons, steps
4. **Technical** — code and numbers

:::


<!-- The agenda slide lists the sections of the talk with large numbers. -->
<!-- Keep it to four or five lines, one per divider. -->
<!-- Let me start with the simplest layout — a plain list. -->
---

<!-- _class: invert -->

## Bullet list

A short lead-in sentence sets the context for the points below.

- **Bold lead** — a point with a short explanation
- **Another point** — keep each line to one idea
- **Third point** — three to five items read best
- **Last point** — end with the takeaway

Closing sentence that ties the list together.


<!-- This is the default content slide: a title, an optional lead-in, a list, and a closing line. -->
<!-- Content is centered between the header and the footer, while the title stays where it is. -->
<!-- Keep it to three to five bullets, and one idea per line. -->
---

<!-- _class: divider -->

# Layouts

Columns, cards, tables, callouts and images


<!-- The divider slide marks a new section. -->
<!-- Use it to give the audience a breather between topics. -->
---

## Step-by-step reveal

* **First** point appears on its own
* **Second** point joins it on the next click
* **Third** point follows

Use `*` instead of `-` for bullets that reveal one at a time.


<!-- Bullets written with an asterisk are revealed one by one in the HTML build. -->
<!-- In PDF and PPTX exports they all show at once. -->
---

<!-- _class: invert -->

## Two columns

:::: columns
::: col

### Left

- Text, lists or images
- Equal width
- Gap between columns

:::
::: col

### Right

- Another list
- Or a paragraph
- Or a code block

:::
::::


<!-- Columns split the slide in two equal halves. -->
<!-- Anything works inside: lists, paragraphs, images, or code. -->
---

## Three cards

:::: columns three
::: card

### Fast

Builds in seconds from plain Markdown.

:::
::: card

### Flexible

Every layout is a class on a slide.

:::
::: card

### Portable

Share as HTML, PDF or PPTX.

:::
::::


<!-- Three columns with cards work well for features or options. -->
<!-- A card is just a boxed container, and you can use it anywhere. -->
---

<!-- _class: invert -->

## Table

| Format | Best for | Speaker notes |
| --- | --- | --- |
| HTML | Presenting live | Yes |
| PDF | Sharing | No |
| PPTX | Editing elsewhere | No |


<!-- Tables are styled with a header row and zebra stripes. -->
<!-- Keep them small, since three or four columns are the limit for a slide. -->
---

## Callout

A paragraph sets up the point, and the blockquote below stands out as a callout.

> Put the one sentence the audience must remember in a blockquote


<!-- A blockquote on a regular slide becomes a callout box. -->
<!-- Use it for the takeaway, a warning, or a note. -->
---

<!-- _class: invert -->

## Image split

![bg right:40%](assets/illustration.svg)

- Image on the right, text on the left
- Use `bg left` to flip it
- Change the width with `:40%`


<!-- Marp background images can take part of the slide. -->
<!-- Here the image fills the right forty percent, and the text uses the rest. -->
---

## Figure

::: figure

![](assets/screenshot.svg)

A framed screenshot with a rounded border, a shadow and a caption

:::


<!-- The figure frame is for screenshots and diagrams that sit inside the content. -->
<!-- It adds a rounded border and a soft shadow, and the caption goes below. -->
---

<!-- _class: lead -->
<!-- _paginate: false -->
<!-- _header: "" -->
<!-- _footer: "" -->

![bg brightness:0.5 blur:6px](assets/illustration.svg)

# Full-bleed image

## A background behind a title slide


<!-- A plain bg image fills the whole slide. -->
<!-- Filters like brightness and blur keep the title readable. -->
---

<!-- _class: invert quote -->

> One slide, **one idea**. Say it **plainly.**

The quote slide


<!-- The quote slide is for a single statement you want people to remember. -->
<!-- Bold parts turn into gradient text, and the line below is the attribution. -->
---

## Compare — before / after

:::: compare
::: card before

### Before

- Many tools, many formats
- Manual copy and paste
- Hard to keep in sync

:::
::: card after

### After

- One source of truth
- Automated steps
- Always up to date

:::
::::


<!-- Use compare to show a change. The muted card is the old state, the highlighted card is the new one. -->
<!-- The arrow between them says: this turns into that. -->
---

<!-- _class: invert -->

## Compare — plain (pros / cons)

:::: compare plain
::: card after

### Pros

- Fast to set up
- Easy to read
- Works everywhere

:::
::: card before

### Cons

- Limited layouts
- Needs a build step

:::
::::


<!-- The plain variant drops the arrow, so it fits pros and cons, where nothing turns into anything. -->
<!-- The highlighted card is the one you want to emphasise. -->
---

## Steps — horizontal

::: steps

1. **Write** the content in Markdown
2. **Style** it with a theme
3. **Build** HTML, PDF or PPTX
4. **Present** with speaker notes

:::


<!-- Steps show a process from left to right, with numbered markers and connectors. -->
<!-- Keep the text under each step short. -->
---

<!-- _class: invert -->

## Steps — vertical

::: steps vertical

1. **Draft** the outline
2. **Refine** the wording
3. **Publish** the deck

:::


<!-- The vertical variant is better when each step needs a little more room. -->
---

<!-- _class: code -->

## Code — light

```ts
const deck = await Deck.load('slides.md');
deck.on('slide', (index, slide) => {
  // update the progress bar on every slide change
  progress.set(index / deck.length);
});
```

Fenced code with syntax colours and an optional caption.


<!-- The code slide gives a fenced block the full width, with syntax highlighting. -->
<!-- A caption below explains what the reader is looking at. -->
---

<!-- _class: invert code -->

## Code — dark

```json
{
  "theme": "modern",
  "paginate": true,
  "slides": [{ "id": "intro", "layout": "lead" }]
}
```

The same layout on a dark slide.


<!-- It works the same way on a dark slide, with colours tuned for dark backgrounds. -->
---

<!-- _class: invert -->

## Stats

:::: stats
::: stat
### 15
slide types
:::
::: stat
### 2
color modes
*light, dark*
:::
::: stat
### 3
export formats
*HTML, PDF, PPTX*
:::
::::

- **Slide types** cover lists, columns, tables, images, quotes, comparisons, processes and code
- **Color modes** are light and dark, set per slide
- **Export formats** are HTML, PDF and PPTX


<!-- Stats are big-number tiles — good for a status or results slide. -->
<!-- Put the three numbers on top, and explain each one below. -->
---

<!-- _class: lead -->
<!-- _paginate: false -->
<!-- _header: "" -->
<!-- _footer: "" -->

# Next steps

1. **Copy** a slide type you like
2. **Replace** the text with your own
3. **Export** and share

> Questions? Replace this line with your contact


<!-- To use the deck, copy the slide you need and replace the text. -->
<!-- Then build it and share it. -->
<!-- Thank you. -->
