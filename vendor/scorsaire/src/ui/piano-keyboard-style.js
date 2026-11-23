/*
 * Style du clavier à l'écran (`piano-keyboard.js`), repris tel quel de l'afficheur de piano de Jean : toutes les règles sont préfixées par `.pkb` pour ne
 * rien changer ailleurs dans la page. Les roues de couleur ont disparu : l'hôte règle les couleurs par l'API (variables CSS du composant).
 */
export const PIANO_KEYBOARD_CSS = `
    .pkb {
      --base-color: #b1915e;
      --white-rest: #cdc9c6;
      --white-rest-top: #d5d1ce;
      --white-rest-bot: #c5c1be;
      --black-rest-top: #3a3a3a;
      --black-rest-mid: #2a2a2a;
      --black-rest-bot: #181818;
      --key-name-color: #555555;
      --note-name-color: #c4c5c7;
      --frame-color: #252628;
      --btn-bg: #2a2b2d;
      --btn-border: #3a3b3d;
      --btn-icon: #cccccc;
      --btn-hover-bg: #3a3b3d;
      --btn-hover-icon: #ffffff;
      --key-border: #3a3836;
      --top-bar-line: #1a1b1d;
      --slider-bg: #1a1b1d;
      --slider-border: #3a3b3d;
      --slider-fill: color-mix(in srgb, var(--base-color) 55%, transparent);
      --slider-thumb: var(--base-color);
      --slider-center: color-mix(in srgb, var(--note-name-color) 45%, transparent);
      --finger-bg-white: #1a1a1a;
      --finger-fg-white: #ffffff;
      --finger-bg-black: #ffffff;
      --finger-fg-black: #1a1a1a;
      --finger-size: 14px;
      --kb-width: 100%;
      --kb-height: 108px;
      --black-height: 62%;
      width: var(--kb-width);
      max-width: 100%;
      background: var(--frame-color);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      user-select: none;
    }
    .pkb .top-bar {
      height: 28px;
      background: var(--frame-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px;
      position: relative;
      gap: 8px;
    }
    .pkb .top-bar::after {
      content: "";
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: var(--top-bar-line);
    }
    .pkb .top-left,
.pkb .top-right {
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 2;
    }
    .pkb .pan-handle {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 6;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--btn-bg) 80%, transparent);
      border: 1px solid var(--btn-border);
      cursor: grab;
      touch-action: none;
      user-select: none;
      opacity: 0.55;
      transition: opacity 0.15s, background 0.15s;
    }
    .pkb .pan-handle:hover,
.pkb .pan-handle:active {
      opacity: 1;
      background: var(--btn-bg);
    }
    .pkb .pan-handle:active {
      cursor: grabbing;
    }
    .pkb .pan-handle i {
      display: block;
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--btn-icon);
      opacity: 0.85;
      pointer-events: none;
    }
    .pkb .icon-btn {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--btn-bg);
      border: 1px solid var(--btn-border);
      border-radius: 4px;
      cursor: pointer;
      color: var(--btn-icon);
      font-size: 13px;
      transition: background 0.15s, color 0.15s;
    }
    .pkb .icon-btn:hover {
      background: var(--btn-hover-bg);
      color: var(--btn-hover-icon);
    }
    .pkb .color-swatch-btn {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--base-color);
      border: 1.5px solid var(--btn-border);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.15);
      cursor: pointer;
      padding: 0;
    }
    .pkb .keyboard {
      position: relative;
      height: var(--kb-height);
      background: var(--frame-color);
      padding: 0 4px 4px 4px;
      overflow: hidden; 
    }
    .pkb .keyboard.view-controls {
      padding: 6px 8px 8px;
    }
    .pkb .keyboard.view-controls .keys-area { display: none; }
    .pkb .keyboard.view-controls .controls-panel { display: flex; }
    .pkb.view-controls .pan-handle { display: none; }
    .pkb.view-controls .keys-btn { opacity: 0.35; pointer-events: none; }
    .pkb .controls-panel {
      display: none;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      width: 100%;
      height: 100%;
      min-height: 0;
    }
    .pkb .ctrl-top {
      position: relative;
      flex: 0 0 auto;
    }
    .pkb .ctrl-menu {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
    }
    .pkb .ctrl-menu-item {
      background: var(--btn-bg);
      border: 1px solid var(--btn-border);
      color: var(--btn-icon);
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      padding: 5px 8px;
      cursor: pointer;
      text-align: center;
      line-height: 1.1;
      white-space: nowrap;
    }
    .pkb .ctrl-menu-item:hover { filter: brightness(1.12); }
    .pkb .ctrl-menu-item.active {
      background: color-mix(in srgb, var(--base-color) 55%, var(--btn-bg));
      border-color: color-mix(in srgb, var(--base-color) 40%, var(--btn-border));
      color: #fff;
    }
    .pkb .ctrl-menu-item.cc-free {
      min-width: 48px;
      letter-spacing: 0.2px;
    }
    .pkb .controls-panel.drawer-open .ctrl-menu {
      display: none;
    }
    .pkb .controls-panel.drawer-open .ctrl-strip-wrap {
      display: none !important;
    }
    .pkb .controls-panel.drawer-open .ctrl-top {
      flex: 1 1 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .pkb .ctrl-drawer {
      display: none;
      margin: 0;
      padding: 4px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--btn-bg) 85%, #000);
      border: 1px solid var(--btn-border);
      box-shadow: none;
      flex: 1 1 0;
      min-height: 0;
      flex-direction: column;
      gap: 4px;
    }
    .pkb .ctrl-drawer.open { display: flex; }
    .pkb .ctrl-drawer-head {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      flex: 1 1 0;
      min-height: 0;
    }
    .pkb .ctrl-drawer-display {
      text-align: center;
      font-size: 14px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--note-name-color);
      letter-spacing: 2px;
      line-height: 1.2;
      min-width: 3ch;
    }
    .pkb .ctrl-drawer-display span.placeholder { opacity: 0.35; }
    .pkb .ctrl-drawer-clear {
      background: var(--btn-bg);
      border: 1px solid var(--btn-border);
      color: var(--btn-icon);
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      height: 70%;
      max-height: 28px;
      min-height: 18px;
      padding: 0 7px;
      cursor: pointer;
      opacity: 0.85;
    }
    .pkb .ctrl-numpad {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr)) minmax(36px, 0.85fr);
      grid-template-rows: 1fr 1fr;
      flex: 2 1 0;
      min-height: 0;
      gap: 4px;
    }
    .pkb .ctrl-numpad button {
      background: var(--btn-bg);
      border: 1px solid var(--btn-border);
      color: var(--btn-icon);
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      height: 100%;
      min-height: 0;
      max-height: 100%;
      padding: 0;
      cursor: pointer;
      line-height: 1;
    }
    .pkb .ctrl-numpad button:hover { filter: brightness(1.1); }
    .pkb .ctrl-numpad button.ok {
      grid-column: 6;
      grid-row: 1 / span 2;
      height: 100%;
      background: color-mix(in srgb, var(--base-color) 50%, var(--btn-bg));
      color: #fff;
      border-color: color-mix(in srgb, var(--base-color) 35%, var(--btn-border));
      font-size: 12px;
      letter-spacing: 0.5px;
    }
    .pkb .ctrl-strip-wrap {
      flex: 1;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      justify-content: center;
    }
    .pkb .ctrl-strip-label {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 11px;
      font-weight: 600;
      color: var(--note-name-color);
      padding: 0 2px;
      letter-spacing: 0.3px;
    }
    .pkb .ctrl-value {
      font-variant-numeric: tabular-nums;
      opacity: 0.85;
      font-size: 12px;
    }
    .pkb .ctrl-strip {
      position: relative;
      height: 40px;
      border-radius: 8px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.06), transparent 40%),
        var(--slider-bg);
      border: 1px solid var(--slider-border);
      box-shadow: inset 0 2px 6px rgba(0,0,0,0.35);
      touch-action: none;
      cursor: pointer;
      overflow: hidden;
      user-select: none;
    }
    .pkb .ctrl-center {
      position: absolute;
      top: 4px;
      bottom: 4px;
      left: 50%;
      width: 2px;
      margin-left: -1px;
      background: var(--slider-center);
      border-radius: 1px;
      pointer-events: none;
      z-index: 1;
    }
    .pkb .ctrl-strip.unipolar .ctrl-center { display: none; }
    .pkb .ctrl-fill {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      width: 0;
      background: var(--slider-fill);
      pointer-events: none;
      z-index: 0;
    }
    .pkb .ctrl-strip.unipolar .ctrl-fill {
      left: 0;
    }
    .pkb .ctrl-thumb {
      position: absolute;
      top: 3px;
      bottom: 3px;
      width: 18px;
      margin-left: -9px;
      left: 50%;
      border-radius: 6px;
      background: linear-gradient(180deg, color-mix(in srgb, var(--slider-thumb) 30%, #fff), var(--slider-thumb));
      border: 1px solid color-mix(in srgb, var(--slider-thumb) 40%, #000);
      box-shadow: 0 1px 4px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.25);
      z-index: 2;
      pointer-events: none;
    }
    .pkb .keys-area {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .pkb .pan-ext {
      position: absolute;
      top: 0;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    }
    .pkb .pan-ext.left { right: 100%; }
    .pkb .pan-ext.right { left: 100%; }
    .pkb .pan-ext .white-keys {
      display: flex;
      height: 100%;
      width: 100%;
    }
    .pkb .pan-ext .black-keys {
      position: absolute;
      top: 0; left: 0; width: 100%;
      height: var(--black-height);
      pointer-events: none;
    }
    .pkb .white-keys {
      display: flex;
      height: 100%;
      width: 100%;
      position: relative;
      z-index: 1;
    }
    .pkb .white-key {
      flex: 1;
      height: 100%;
      background: linear-gradient(to bottom, var(--white-rest-top) 0%, var(--white-rest) 40%, var(--white-rest-bot) 100%);
      border: 1px solid var(--key-border);
      border-top: none;
      border-radius: 0 0 3px 3px;
      position: relative;
      box-shadow:
        inset 0 -2px 0 rgba(0, 0, 0, 0.1),
        inset 1px 0 0 rgba(255, 255, 255, 0.2),
        inset -1px 0 0 rgba(0, 0, 0, 0.08);
      margin-right: -1px;
      cursor: pointer;
      outline: none;
      -webkit-tap-highlight-color: transparent;
      transition: none;
    }
    .pkb .white-key:last-child {
      margin-right: 0;
    }
    .pkb .white-key:focus,
.pkb .white-key:active {
      outline: none;
    }
    .pkb .white-key.active {
      background: linear-gradient(
        to bottom,
        color-mix(in srgb, var(--base-color) calc(35% + 50% * var(--vel, 1)), var(--white-rest-top)) 0%,
        color-mix(in srgb, var(--base-color) calc(40% + 60% * var(--vel, 1)), var(--white-rest)) 45%,
        color-mix(in srgb, var(--base-color) calc(30% + 45% * var(--vel, 1)), var(--white-rest-bot)) 100%
      ) !important;
      border-color: color-mix(in srgb, var(--base-color) calc(25% + 25% * var(--vel, 1)), var(--key-border));
      box-shadow:
        inset 0 -2px 0 rgba(0, 0, 0, 0.18),
        inset 1px 0 0 color-mix(in srgb, var(--base-color) calc(20% + 20% * var(--vel, 1)), white),
        inset -1px 0 0 rgba(0, 0, 0, 0.12);
    }
    .pkb .key-name {
      position: absolute;
      top: 5px;
      left: 34%;
      transform: translateX(-50%);
      font-size: 9px;
      font-weight: 600;
      color: var(--key-name-color);
      pointer-events: none;
      letter-spacing: 0;
      line-height: 1;
      white-space: nowrap;
    }
    .pkb .white-key.active .key-name {
      color: rgba(255,255,255,0.85);
      text-shadow: 0 1px 1px rgba(0,0,0,0.3);
    }
    .pkb .finger-badge {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      width: var(--finger-size);
      height: var(--finger-size);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: calc(var(--finger-size) * 0.62);
      font-weight: 700;
      line-height: 1;
      pointer-events: none;
      z-index: 3;
      box-shadow: 0 1px 2px rgba(0,0,0,0.35);
      user-select: none;
    }
    .pkb .white-key .finger-badge {
      bottom: 10%;
      background: var(--finger-bg-white);
      color: var(--finger-fg-white);
    }
    .pkb .black-key .finger-badge {
      bottom: 8%;
      background: var(--finger-bg-black);
      color: var(--finger-fg-black);
      box-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }
    .pkb .play-labels {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 5;
    }
    .pkb .play-label-item {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      font-size: 13px;
      font-weight: 600;
      color: var(--note-name-color);
      white-space: nowrap;
      letter-spacing: 0.3px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }
    .pkb .black-keys {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: var(--black-height);
      z-index: 2;
      pointer-events: none;
    }
    .pkb .black-key {
      position: absolute;
      width: 11px;
      height: 100%;
      background: linear-gradient(
        to bottom,
        var(--black-rest-top) 0%,
        var(--black-rest-mid) 40%,
        var(--black-rest-bot) 100%
      );
      border-radius: 0 0 2px 2px;
      border: 1px solid rgba(0, 0, 0, 0.45);
      border-top: none;
      box-shadow:
        0 2px 4px rgba(0, 0, 0, 0.5),
        inset 1px 0 0 rgba(255, 255, 255, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.08),
        inset -1px 0 0 rgba(0, 0, 0, 0.28),
        inset 0 -5px 0 rgba(0, 0, 0, 0.55),
        inset 0 -7px 2px rgba(0, 0, 0, 0.25);
      pointer-events: auto;
      cursor: pointer;
      outline: none;
      -webkit-tap-highlight-color: transparent;
      transition: none;
    }
    .pkb .black-key:focus,
.pkb .black-key:active {
      outline: none;
    }
    .pkb .black-key.active {
      background: linear-gradient(
        to bottom,
        color-mix(in srgb, var(--base-color) calc(40% + 50% * var(--vel, 1)), var(--black-rest-top)) 0%,
        color-mix(in srgb, var(--base-color) calc(35% + 45% * var(--vel, 1)), var(--black-rest-mid)) 40%,
        color-mix(in srgb, var(--base-color) calc(30% + 35% * var(--vel, 1)), var(--black-rest-bot)) 100%
      ) !important;
      border-left: 1px solid color-mix(in srgb, var(--base-color) calc(20% + 20% * var(--vel, 1)), black);
      border-right: none;
      box-shadow:
        0 2px 3px rgba(0, 0, 0, 0.45),
        inset 1px 0 0 color-mix(in srgb, var(--base-color) calc(25% + 25% * var(--vel, 1)), white),
        inset 0 1px 0 color-mix(in srgb, var(--base-color) calc(15% + 20% * var(--vel, 1)), white),
        inset -1px 0 0 color-mix(in srgb, var(--base-color) 10%, black),
        inset 0 -5px 0 color-mix(in srgb, var(--base-color) calc(15% + 20% * var(--vel, 1)), black),
        inset 0 -7px 2px rgba(40, 28, 10, 0.4);
    }

.pkb-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 3000; display: flex; align-items: center; justify-content: center; }
.pkb-modal { background: var(--frame-color, #2a2b2d); border: 1px solid var(--btn-border, #3a3b3d); border-radius: 10px; padding: 16px 18px; min-width: 240px; max-width: 92vw; box-shadow: 0 12px 32px rgba(0,0,0,0.35); color: var(--btn-icon, #e0e0e0); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.pkb-modal h3 { font-size: 13px; font-weight: 600; margin: 0 0 12px; }
.pkb-modal .pkb-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.pkb-modal .pkb-row label { font-size: 12px; opacity: 0.75; min-width: 60px; }
.pkb-modal .pkb-stepper { display: flex; align-items: center; gap: 4px; background: var(--btn-bg, #1e1f21); border-radius: 4px; padding: 2px 4px; border: 1px solid var(--btn-border, #333); }
.pkb-modal .pkb-stepper button, .pkb-pop button, .pkb-modal .pkb-presets button, .pkb-modal .pkb-close { background: var(--btn-bg, #333); border: 1px solid var(--btn-border, #3a3b3d); color: var(--btn-icon, #ccc); cursor: pointer; }
.pkb-modal .pkb-stepper button:hover, .pkb-pop button:hover, .pkb-modal .pkb-presets button:hover, .pkb-modal .pkb-presets button.active, .pkb-modal .pkb-close:hover { background: var(--btn-hover-bg, #444); color: var(--btn-hover-icon, #fff); }
.pkb-modal .pkb-stepper button { width: 28px; height: 28px; border-radius: 3px; font-size: 14px; }
.pkb-modal .pkb-stepper input { width: 44px; background: transparent; border: none; color: inherit; text-align: center; font-size: 16px; font-weight: 500; outline: none; }
.pkb-modal .pkb-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.pkb-modal .pkb-presets button { font-size: 12px; padding: 6px 10px; border-radius: 4px; }
.pkb-modal .pkb-note { text-align: center; font-size: 13px; color: var(--note-name-color, #c4c5c7); letter-spacing: 0.5px; margin: -4px 0 12px; }
.pkb-modal .pkb-hint { font-size: 10px; opacity: 0.6; margin: 8px 0 0; line-height: 1.35; text-align: center; }
.pkb-modal .pkb-close { margin-top: 14px; width: 100%; padding: 8px; border-radius: 4px; font-size: 12px; }
.pkb-pop { position: fixed; z-index: 3001; display: flex; flex-direction: column; gap: 4px; padding: 6px; background: var(--frame-color, #2a2b2d); border: 1px solid var(--btn-border, #3a3b3d); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); color: var(--btn-icon, #e0e0e0); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.pkb-pop button { display: flex; align-items: center; gap: 8px; text-align: left; font-size: 13px; padding: 8px 12px; border-radius: 5px; white-space: nowrap; min-height: 36px; }
.pkb-pop button .pkb-check { width: 14px; display: inline-block; text-align: center; font-weight: 700; }
.pkb.pkb-readonly .white-key, .pkb.pkb-readonly .black-key { cursor: default; }
.pkb { margin: 0 auto; }
`;
