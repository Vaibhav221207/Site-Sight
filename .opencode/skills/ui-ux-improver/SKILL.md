---
name: web-game-ui-ux
description: >
  Design and build game UI/UX — HUDs, menus, and overlays — that survive every screen using only vanilla HTML/CSS/JS: 
  CSS Grid/Flexbox for anchor-based responsive layout, CSS variables/aspect-ratio for resolution scaling, 
  CSS env() for safe areas, tabindex and Gamepad API for focus navigation, a DOM-based screen state stack, 
  and JS CustomEvent-driven (not RequestAnimationFrame-polled) HUD updates.
---

# Web Game UI/UX (HTML/CSS/JS)

Build DOM-based HUDs and menus that layer perfectly over your HTML5 Canvas or WebGL game, staying correct on a mobile phone, an ultrawide monitor, and a TV. This skill owns the web-native UI architecture — responsive layout, scaling, focus navigation, screen flow, and how the UI talks to the game state.

## When to use

- Use when building a HUD (health/ammo/score), a menu (main/pause/settings), or any overlay on top of a web game canvas.
- Use to fix UI that breaks on different browser window sizes, ignores mobile notches/safe areas, can't be used with a keyboard/controller, or tanks the frame rate by polling game state.
- Use to structure screen flow (title → game → pause) as a stack of hidden/visible DOM elements, not spaghetti code.

**When *not* to use:** For drawing actual game entities (player, enemies, projectiles) — use the Canvas API or WebGL for that. For intense visual juice (particle explosions) that belong *in* the game world, keep it on the canvas rather than the DOM.

## Core workflow

1. **Pick a layout model: CSS Flexbox & Grid, never absolute pixels.** Anchor elements using `position: absolute` on the container and let Flexbox flow the children. `top: 250px` breaks on different screens.
2. **Choose a scaling strategy:** Use a wrapper `div` with CSS `aspect-ratio` and `width: 100vmin`, or use CSS `transform: scale()` calculated via JS on window resize to perfectly scale the UI to match the canvas.
3. **Respect the safe area.** Inset critical UI from screen edges using CSS `env(safe-area-inset-*)` so mobile phone notches don't clip your HUD.
4. **Make every screen keyboard/gamepad navigable.** Native HTML handles basic `Tab` focus, but you must map the `Gamepad API` to DOM focus using `element.focus()`. Always style the `:focus-visible` state.
5. **Model screens as a stack.** Treat your screens (`#main-menu`, `#pause-menu`, `#hud`) as layers. Push (remove `hidden` class), pop (add `hidden` class). 
6. **Drive the HUD from CustomEvents, not polling.** The HUD adds an event listener for `score_changed` and updates only when fired — do not update `innerHTML` inside your 60fps `requestAnimationFrame` loop.
7. **Verify across screens.** Use Chrome DevTools Device Mode. Switch devices, test landscape/portrait, navigate using only the keyboard (`Tab`/`Enter`), and ensure UI elements don't overlap.

## Patterns

### 1. Anchors + containers, not absolute coordinates

```html
<!-- HTML: A HUD container with semantic sections -->
<div id="game-ui">
  <div class="hud-top-left">
    <div id="health-bar" class="flex-row">
      <!-- JS will inject heart SVGs here -->
    </div>
  </div>
</div>