const svgNamespace = "http://www.w3.org/2000/svg";
const stage = document.getElementById("widget-stage");
const selectionMarquee = document.getElementById("selection-marquee");
const stageViewport = document.getElementById("stage-viewport");
const bubbleLayer = document.getElementById("bubble-layer");
const linkLayer = document.getElementById("link-layer");
const previewLine = document.getElementById("link-preview");
const startupBrand = document.getElementById("startup-brand");
const emptyHint = document.getElementById("empty-hint");
const minimapPanel = document.querySelector(".minimap-panel");
const minimapFrame = document.getElementById("minimap-frame");
const minimapLinks = document.getElementById("minimap-links");
const minimapBubbles = document.getElementById("minimap-bubbles");
const minimapViewport = document.getElementById("minimap-viewport");
const dpadUpButton = document.querySelector(".dpad-up");
const dpadLeftButton = document.querySelector(".dpad-left");
const dpadRightButton = document.querySelector(".dpad-right");
const dpadDownButton = document.querySelector(".dpad-down");
const triangleButton = document.querySelector(".symbol-triangle-button");
const circleButton = document.querySelector(".symbol-circle-button");
const squareButton = document.querySelector(".symbol-square-button");
const xButton = document.querySelector(".symbol-x-button");
const l1Button = document.querySelector(".shoulder-l1-button");
const l2Button = document.querySelector(".shoulder-l2-button");
const r1Button = document.querySelector(".shoulder-r1-button");
const r2Button = document.querySelector(".shoulder-r2-button");
const zoomOutButton = document.getElementById("zoom-out");
const zoomInButton = document.getElementById("zoom-in");
const panButtons = Array.from(document.querySelectorAll("[data-pan-direction]"));
const analogSticks = Array.from(document.querySelectorAll(".analog-stick"));

const state = {
  hasEnteredApp: false,
  bubbles: [],
  links: [],
  nextBubbleId: 1,
  nextLinkId: 1,
  drag: null,
  activeEditor: null,
  selectedBubbleId: null,
  selectedBubbleIds: new Set(),
  rafId: 0,
  lastSceneTime: 0,
  panIntent: null,
  panRafId: 0,
  panLastFrame: 0,
  panX: 0,
  panY: 0,
  zoom: 1,
  minimapBounds: null,
  minimapDrag: null,
  suppressMinimapClick: false,
  viewportPreviewTimerId: 0,
  marqueeSelection: null,
  analogDrag: null,
  pressedKeys: new Set(),
  activeKeyBindings: new Set(),
  keyboardPanOrder: [],
};

const zoomStep = 0.15;
const minZoom = 0.7;
const maxZoom = 1.8;
const manualPanSpeed = 520;
const bubbleResonanceMaxOffset = 12;
const bubbleFastDragSpeedThreshold = 0.055;
const bubbleFastDragSpeedMax = 1.7;
const bubbleDragVelocityDecay = 17;
const bubbleDragSpring = 255;
const bubbleDragDamping = 23;
const bubbleDragReturnSpringMultiplier = 1.32;
const bubbleDragReturnDampingMultiplier = 1.18;
const bubbleDragStillnessMs = 24;
const bubbleDragMaxOffset = 15;
const keyBoundButtons = {
  triangle: triangleButton,
  circle: circleButton,
  square: squareButton,
  x: xButton,
  dpadUp: dpadUpButton,
  dpadLeft: dpadLeftButton,
  dpadRight: dpadRightButton,
  dpadDown: dpadDownButton,
  l1: l1Button,
  l2: l2Button,
  r1: r1Button,
  r2: r2Button,
};

window.addEventListener("resize", () => {
  for (const bubble of state.bubbles) {
    keepBubbleInBounds(bubble);
    fitBubbleText(bubble);
  }
  redrawLinks();
  applyZoom();
  requestAnimationLoop();
});

document.addEventListener("pointerdown", (event) => {
  if (state.activeEditor && !state.activeEditor.element.contains(event.target)) {
    state.activeEditor.label.blur();
  }
});

document.addEventListener("keydown", (event) => {
  if (shouldIgnoreKeyboardShortcut(event)) {
    return;
  }

  if (!hasStarted() && event.code === "Enter") {
    event.preventDefault();
    enterApp();
    return;
  }

  if (
    hasStarted() &&
    state.selectedBubbleIds.size > 0 &&
    (event.code === "Delete" || event.code === "Backspace")
  ) {
    event.preventDefault();
    deleteSelectedBubbles();
    return;
  }

  if (event.code === "Space") {
    const selectedBubble =
      state.selectedBubbleIds.size === 1 && state.selectedBubbleId
        ? getBubbleById(state.selectedBubbleId)
        : null;

    if (selectedBubble && !selectedBubble.isEditing) {
      event.preventDefault();
      startEditing(selectedBubble);
    }
    return;
  }

  const isTrackedKey =
    event.code === "KeyW" ||
    event.code === "KeyA" ||
    event.code === "KeyS" ||
    event.code === "KeyD" ||
    event.code === "ArrowUp" ||
    event.code === "ArrowLeft" ||
    event.code === "ArrowRight" ||
    event.code === "ArrowDown" ||
    event.code === "KeyQ" ||
    event.code === "KeyE" ||
    event.code === "ShiftLeft" ||
    event.code === "ShiftRight";

  if (!isTrackedKey) {
    return;
  }

  event.preventDefault();
  state.pressedKeys.add(event.code);
  syncKeyboardBindings();
});

document.addEventListener("keyup", (event) => {
  if (
    event.code !== "KeyW" &&
    event.code !== "KeyA" &&
    event.code !== "KeyS" &&
    event.code !== "KeyD" &&
    event.code !== "ArrowUp" &&
    event.code !== "ArrowLeft" &&
    event.code !== "ArrowRight" &&
    event.code !== "ArrowDown" &&
    event.code !== "KeyQ" &&
    event.code !== "KeyE" &&
    event.code !== "ShiftLeft" &&
    event.code !== "ShiftRight"
  ) {
    return;
  }

  state.pressedKeys.delete(event.code);
  syncKeyboardBindings();
});

stage.addEventListener("dblclick", (event) => {
  if (
    event.target.closest(".bubble") ||
    event.target.closest(".widget-panel") ||
    event.target.closest(".minimap-panel")
  ) {
    return;
  }

  createBubble(clientPointToWorld(event.clientX, event.clientY));
  requestAnimationLoop();
});

stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !hasStarted()) {
    return;
  }

  if (
    event.target.closest(".bubble") ||
    event.target.closest(".widget-panel") ||
    event.target.closest(".minimap-panel")
  ) {
    return;
  }

  beginMarqueeSelection(event);
});

stage.addEventListener(
  "wheel",
  (event) => {
    if (!hasStarted()) {
      return;
    }

    if (event.ctrlKey) {
      event.preventDefault();
      const zoomDelta = -event.deltaY * 0.0025;
      const nextZoom = state.zoom * (1 + zoomDelta);
      setZoom(nextZoom, { revealViewport: true, clientX: event.clientX, clientY: event.clientY });
      return;
    }

    event.preventDefault();
    state.panX -= event.deltaX;
    state.panY -= event.deltaY;
    applyZoom({ revealViewport: true });
  },
  { passive: false }
);

zoomOutButton.addEventListener("click", () => {
  if (!hasStarted()) {
    return;
  }

  setZoom(state.zoom - zoomStep, { revealViewport: true });
});

zoomInButton.addEventListener("click", () => {
  if (!hasStarted()) {
    return;
  }

  setZoom(state.zoom + zoomStep, { revealViewport: true });
});

squareButton.addEventListener("click", () => {
  if (!hasStarted() || state.selectedBubbleIds.size === 0) {
    return;
  }

  deleteSelectedBubbles();
});

circleButton.addEventListener("click", () => {
  createBubble();
  requestAnimationLoop();
});

minimapFrame.addEventListener("click", (event) => {
  if (!hasStarted()) {
    return;
  }

  if (state.suppressMinimapClick) {
    state.suppressMinimapClick = false;
    return;
  }

  navigateFromMinimap(event.clientX, event.clientY);
});

minimapFrame.addEventListener("keydown", (event) => {
  if (!hasStarted()) {
    return;
  }

  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  const rect = minimapFrame.getBoundingClientRect();
  navigateFromMinimap(rect.left + rect.width / 2, rect.top + rect.height / 2);
});

minimapViewport.addEventListener("pointerdown", (event) => {
  if (!hasStarted()) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  beginMinimapViewportDrag(event);
});

for (const panButton of panButtons) {
  panButton.addEventListener("pointerdown", (event) => {
    if (!hasStarted()) {
      return;
    }

    event.preventDefault();
    startManualPan(panButton.dataset.panDirection, panButton);
  });

  panButton.addEventListener("pointerup", stopManualPan);
  panButton.addEventListener("pointercancel", stopManualPan);
  panButton.addEventListener("pointerleave", stopManualPan);
}

for (const analogStick of analogSticks) {
  analogStick.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    beginAnalogStickDrag(event, analogStick);
  });
}

function createBubble(options = {}) {
  enterApp();
  const id = `bubble-${state.nextBubbleId++}`;
  const radius = 48;
  const spawnPoint = options.x != null && options.y != null ? options : pickSpawnPoint(radius);
  const { x, y } = spawnPoint;

  const element = document.createElement("article");
  element.className = "bubble";
  element.dataset.id = id;

  const label = document.createElement("div");
  label.className = "bubble-label";
  label.setAttribute("spellcheck", "false");
  label.setAttribute("aria-label", "Bubble text");
  label.setAttribute("contenteditable", "false");
  element.appendChild(label);

  const bubble = {
    id,
    baseRadius: radius,
    radius,
    x,
    y,
    element,
    label,
    connections: new Set(),
    children: new Set(),
    clickTimerId: 0,
    dragJelloX: 0,
    dragJelloY: 0,
    dragJelloVX: 0,
    dragJelloVY: 0,
    isEditing: false,
  };

  label.addEventListener("input", () => {
    fitBubbleText(bubble);
  });

  label.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      label.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      label.blur();
    }
  });

  label.addEventListener("blur", () => {
    stopEditing(bubble);
  });

  element.addEventListener("animationend", (event) => {
    if (event.animationName === "bubble-resonance") {
      element.classList.remove("is-resonating");
    }
  });

  element.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearBubbleClickTimer(bubble);
    setSelectedBubbles([bubble]);
    if (!bubble.isEditing) {
      startEditing(bubble);
    }
  });

  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || bubble.isEditing) {
      return;
    }

    beginBubbleInteraction(event, bubble);
  });

  bubbleLayer.appendChild(element);
  state.bubbles.push(bubble);
  toggleEmptyHint();

  keepBubbleInBounds(bubble);
  renderBubble(bubble);
  fitBubbleText(bubble);

  return bubble;
}

function beginBubbleInteraction(event, bubble) {
  setSelectedBubbles([bubble]);
  const worldPoint = clientPointToWorld(event.clientX, event.clientY);
  const interaction = {
    bubble,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    offsetX: worldPoint.x - bubble.x,
    offsetY: worldPoint.y - bubble.y,
    didDrag: false,
  };

  bubble.element.setPointerCapture(event.pointerId);

  const handleMove = (moveEvent) => {
    if (moveEvent.pointerId !== interaction.pointerId) {
      return;
    }

    const movedDistance = Math.hypot(
      moveEvent.clientX - interaction.startClientX,
      moveEvent.clientY - interaction.startClientY
    );

    if (!interaction.didDrag && movedDistance > 6) {
      interaction.didDrag = true;
      beginDrag(interaction, moveEvent);
      return;
    }

    if (interaction.didDrag) {
      dragBubble(moveEvent);
    }
  };

  const handleEnd = (endEvent) => {
    if (endEvent.pointerId !== interaction.pointerId) {
      return;
    }

    bubble.element.releasePointerCapture(endEvent.pointerId);
    bubble.element.removeEventListener("pointermove", handleMove);
    bubble.element.removeEventListener("pointerup", handleEnd);
    bubble.element.removeEventListener("pointercancel", handleEnd);

    if (interaction.didDrag) {
      endDrag(endEvent);
      return;
    }
  };

  bubble.element.addEventListener("pointermove", handleMove);
  bubble.element.addEventListener("pointerup", handleEnd);
  bubble.element.addEventListener("pointercancel", handleEnd);
}

function beginDrag(interaction, event) {
  const bubble = interaction.bubble;
  clearBubbleResonance(bubble);
  clearBubbleDragMotion(bubble);
  bubble.element.classList.add("is-dragging");
  const componentIds = getConnectedBubbleIds(bubble.id);

  state.drag = {
    bubble,
    pointerId: event.pointerId,
    offsetX: interaction.offsetX,
    offsetY: interaction.offsetY,
    targetX: bubble.x,
    targetY: bubble.y,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    lastMoveTime: event.timeStamp,
    motionVX: 0,
    motionVY: 0,
    componentIds,
    target: null,
  };
  clearBubbleClickTimer(bubble);
  setSelectedBubbles([bubble]);
  requestAnimationLoop();
  dragBubble(event);
}

function endDrag() {
  if (!state.drag) {
    return;
  }

  const { bubble, target } = state.drag;
  clearBubbleDragMotion(bubble);
  bubble.element.classList.remove("is-dragging");

  if (target) {
    createLink(state.drag.bubble, target);
  }

  clearPreviewTarget();
  state.drag = null;
}

function dragBubble(event) {
  const drag = state.drag;
  const bubble = drag.bubble;
  const worldPoint = clientPointToWorld(event.clientX, event.clientY);
  drag.targetX = worldPoint.x - drag.offsetX;
  drag.targetY = worldPoint.y - drag.offsetY;
  bubble.x = drag.targetX;
  bubble.y = drag.targetY;
  keepBubbleInBounds(bubble);
  drag.targetX = bubble.x;
  drag.targetY = bubble.y;
  const clientDeltaX = event.clientX - drag.lastClientX;
  const clientDeltaY = event.clientY - drag.lastClientY;
  const deltaMs = Math.max(event.timeStamp - drag.lastMoveTime, 8);
  const nextMotionVX = clientDeltaX / deltaMs;
  const nextMotionVY = clientDeltaY / deltaMs;
  drag.motionVX = drag.motionVX * 0.18 + nextMotionVX * 0.82;
  drag.motionVY = drag.motionVY * 0.18 + nextMotionVY * 0.82;
  drag.lastClientX = event.clientX;
  drag.lastClientY = event.clientY;
  drag.lastMoveTime = event.timeStamp;
  renderBubble(bubble);
  redrawLinks();
  const overlapTarget = findOverlapTarget(bubble);
  updatePreviewTarget(bubble, overlapTarget);
  requestAnimationLoop();
}

function createLink(childBubble, parentBubble) {
  if (childBubble.id === parentBubble.id || bubblesAreLinked(childBubble.id, parentBubble.id)) {
    return;
  }

  const linkElement = document.createElementNS(svgNamespace, "line");
  linkElement.classList.add("bubble-link");
  linkLayer.insertBefore(linkElement, previewLine);

  const link = {
    id: `link-${state.nextLinkId++}`,
    a: childBubble.id,
    b: parentBubble.id,
    parentId: parentBubble.id,
    childId: childBubble.id,
    element: linkElement,
  };

  state.links.push(link);
  childBubble.connections.add(parentBubble.id);
  parentBubble.connections.add(childBubble.id);
  parentBubble.children.add(childBubble.id);
  refreshBubbleSizes();
  triggerLinkResonance(childBubble, parentBubble);

  redrawLinks();
}

function startEditing(bubble) {
  if (state.activeEditor && state.activeEditor !== bubble) {
    state.activeEditor.label.blur();
  }

  clearPressedWidgetKeys();
  state.activeEditor = bubble;
  bubble.isEditing = true;
  bubble.element.classList.add("is-editing");
  bubble.label.setAttribute("contenteditable", "true");
  bubble.label.focus();

  if (!bubble.label.textContent.trim()) {
    placeCaretAtEnd(bubble.label);
  } else {
    selectTextContents(bubble.label);
  }
}

function stopEditing(bubble) {
  if (!bubble.isEditing) {
    return;
  }

  bubble.isEditing = false;
  bubble.element.classList.remove("is-editing");
  bubble.label.setAttribute("contenteditable", "false");
  fitBubbleText(bubble);

  if (state.activeEditor === bubble) {
    state.activeEditor = null;
  }
}

function fitBubbleText(bubble) {
  const availableWidth = bubble.radius * 1.42;
  const availableHeight = bubble.radius * 1.18;
  const maxSize = Math.max(16, bubble.radius * 0.52);
  const minSize = Math.max(11, bubble.radius * 0.3);

  bubble.label.style.width = `${availableWidth}px`;
  bubble.label.style.maxHeight = `${availableHeight}px`;
  bubble.label.style.wordBreak = "normal";
  bubble.label.style.overflowWrap = "normal";

  let fontSize = maxSize;
  bubble.label.style.fontSize = `${fontSize}px`;

  while (
    fontSize > minSize &&
    (bubble.label.scrollWidth > availableWidth || bubble.label.scrollHeight > availableHeight)
  ) {
    fontSize -= 0.5;
    bubble.label.style.fontSize = `${fontSize}px`;
  }

  if (bubble.label.scrollWidth > availableWidth || bubble.label.scrollHeight > availableHeight) {
    bubble.label.style.wordBreak = "break-word";
    bubble.label.style.overflowWrap = "anywhere";

    while (
      fontSize > minSize &&
      (bubble.label.scrollWidth > availableWidth || bubble.label.scrollHeight > availableHeight)
    ) {
      fontSize -= 0.5;
      bubble.label.style.fontSize = `${fontSize}px`;
    }
  }
}

function renderBubble(bubble) {
  const diameter = bubble.radius * 2;
  bubble.element.style.setProperty("--diameter", `${diameter}px`);
  bubble.element.style.left = `${bubble.x}px`;
  bubble.element.style.top = `${bubble.y}px`;
}

function clearBubbleResonance(bubble) {
  bubble.element.classList.remove("is-resonating");
}

function clearBubbleDragMotion(bubble) {
  bubble.dragJelloX = 0;
  bubble.dragJelloY = 0;
  bubble.dragJelloVX = 0;
  bubble.dragJelloVY = 0;
  resetBubbleDragJelloVars(bubble);
}

function resetBubbleDragJelloVars(bubble) {
  bubble.element.style.setProperty("--drag-jello-x", "0px");
  bubble.element.style.setProperty("--drag-jello-y", "0px");
  bubble.element.style.setProperty("--drag-jello-rotate", "0deg");
  bubble.element.style.setProperty("--drag-jello-scale-x", "1");
  bubble.element.style.setProperty("--drag-jello-scale-y", "1");
  bubble.element.style.setProperty("--drag-jello-skew-x", "0deg");
  bubble.element.style.setProperty("--drag-jello-skew-y", "0deg");
}

function updateBubbleDragPhysics(deltaSeconds, frameTime) {
  if (!state.drag) {
    return false;
  }

  const drag = state.drag;
  const bubble = drag.bubble;
  const ageMs = frameTime - drag.lastMoveTime;
  const hasSettledInput = ageMs > bubbleDragStillnessMs;
  const decayRate = hasSettledInput ? bubbleDragVelocityDecay * 2.6 : bubbleDragVelocityDecay;
  const inputDecay = Math.exp(-decayRate * deltaSeconds);

  drag.motionVX *= inputDecay;
  drag.motionVY *= inputDecay;

  const speed = Math.hypot(drag.motionVX, drag.motionVY);
  const intensity = clamp(
    (speed - bubbleFastDragSpeedThreshold) / (bubbleFastDragSpeedMax - bubbleFastDragSpeedThreshold),
    0,
    1
  );
  const responseIntensity = Math.pow(intensity, 0.78);
  const targetMagnitude = clamp(responseIntensity * bubbleDragMaxOffset, 0, bubbleDragMaxOffset);
  let targetX = speed > 0.001 ? -(drag.motionVX / speed) * targetMagnitude : 0;
  let targetY = speed > 0.001 ? -(drag.motionVY / speed) * targetMagnitude : 0;
  let spring = bubbleDragSpring;
  let damping = bubbleDragDamping;

  if (hasSettledInput) {
    targetX = 0;
    targetY = 0;
    spring *= bubbleDragReturnSpringMultiplier;
    damping *= bubbleDragReturnDampingMultiplier;
  }

  const accelerationX = (targetX - bubble.dragJelloX) * spring - bubble.dragJelloVX * damping;
  const accelerationY = (targetY - bubble.dragJelloY) * spring - bubble.dragJelloVY * damping;

  bubble.dragJelloVX += accelerationX * deltaSeconds;
  bubble.dragJelloVY += accelerationY * deltaSeconds;
  bubble.dragJelloX += bubble.dragJelloVX * deltaSeconds;
  bubble.dragJelloY += bubble.dragJelloVY * deltaSeconds;

  applyBubbleDragJello(bubble);

  const jelloMagnitude = Math.hypot(bubble.dragJelloX, bubble.dragJelloY);
  const jelloVelocity = Math.hypot(bubble.dragJelloVX, bubble.dragJelloVY);

  if (hasSettledInput && jelloMagnitude < 0.03 && jelloVelocity < 0.32) {
    clearBubbleDragMotion(bubble);
    return false;
  }

  const hasRecentInput = ageMs < 30;
  const hasVelocity = speed > 0.01;
  const hasSpringEnergy = jelloMagnitude > 0.03 || jelloVelocity > 0.32;

  return hasRecentInput || hasVelocity || hasSpringEnergy;
}

function applyBubbleDragJello(bubble) {
  const magnitude = Math.hypot(bubble.dragJelloX, bubble.dragJelloY);

  if (magnitude < 0.001) {
    resetBubbleDragJelloVars(bubble);
    return;
  }

  const normalX = bubble.dragJelloX / magnitude;
  const normalY = bubble.dragJelloY / magnitude;
  const intensity = clamp(magnitude / bubbleDragMaxOffset, 0, 1);
  const visualIntensity = Math.pow(intensity, 0.72);
  const stretch = visualIntensity * 0.24;
  const scaleX = 1 + (Math.abs(normalY) * stretch - Math.abs(normalX) * stretch * 0.78);
  const scaleY = 1 + (Math.abs(normalX) * stretch - Math.abs(normalY) * stretch * 0.78);
  const skewX = -normalY * visualIntensity * 10;
  const skewY = normalX * visualIntensity * 10;
  const rotate = normalX * visualIntensity * 3.4;

  bubble.element.style.setProperty("--drag-jello-x", `${bubble.dragJelloX.toFixed(2)}px`);
  bubble.element.style.setProperty("--drag-jello-y", `${bubble.dragJelloY.toFixed(2)}px`);
  bubble.element.style.setProperty("--drag-jello-rotate", `${rotate.toFixed(2)}deg`);
  bubble.element.style.setProperty("--drag-jello-scale-x", scaleX.toFixed(3));
  bubble.element.style.setProperty("--drag-jello-scale-y", scaleY.toFixed(3));
  bubble.element.style.setProperty("--drag-jello-skew-x", `${skewX.toFixed(2)}deg`);
  bubble.element.style.setProperty("--drag-jello-skew-y", `${skewY.toFixed(2)}deg`);
}

function triggerBubbleResonance(bubble, options = {}) {
  const offsetX = clamp(options.offsetX ?? 0, -bubbleResonanceMaxOffset, bubbleResonanceMaxOffset);
  const offsetY = clamp(options.offsetY ?? -6, -bubbleResonanceMaxOffset, bubbleResonanceMaxOffset);
  const tilt = clamp(options.tilt ?? offsetX * 0.3, -6, 6);

  bubble.element.style.setProperty("--resonance-x", `${offsetX.toFixed(2)}px`);
  bubble.element.style.setProperty("--resonance-y", `${offsetY.toFixed(2)}px`);
  bubble.element.style.setProperty("--resonance-tilt", `${tilt.toFixed(2)}deg`);
  bubble.element.classList.remove("is-resonating");
  void bubble.element.offsetWidth;
  bubble.element.classList.add("is-resonating");
}

function triggerLinkResonance(childBubble, parentBubble) {
  const deltaX = childBubble.x - parentBubble.x;
  const deltaY = childBubble.y - parentBubble.y;
  const distance = Math.hypot(deltaX, deltaY) || 1;
  const normalX = deltaX / distance;
  const normalY = deltaY / distance;
  const childAmplitude = clamp(distance * 0.05, 4, 8);
  const parentAmplitude = clamp(childAmplitude * 0.55, 2.5, 5);

  triggerBubbleResonance(childBubble, {
    offsetX: normalX * childAmplitude,
    offsetY: normalY * childAmplitude - 2,
    tilt: normalX * 4.8,
  });
  triggerBubbleResonance(parentBubble, {
    offsetX: -normalX * parentAmplitude,
    offsetY: -normalY * parentAmplitude - 1,
    tilt: -normalX * 3.2,
  });
}

function keepBubbleInBounds(bubble) {
  const bounds = getBubbleBounds(bubble);
  bubble.x = clamp(bubble.x, bounds.minX, bounds.maxX);
  bubble.y = clamp(bubble.y, bounds.minY, bounds.maxY);
}

function getBubbleBounds(bubble) {
  const padding = 24;
  return {
    minX: bubble.radius + padding,
    maxX: Math.max(bubble.radius + padding, stage.clientWidth - bubble.radius - padding),
    minY: bubble.radius + padding,
    maxY: Math.max(bubble.radius + padding, stage.clientHeight - bubble.radius - padding),
  };
}

function pickSpawnPoint(radius) {
  const attempts = 40;

  for (let index = 0; index < attempts; index += 1) {
    const point = {
      x: randomBetween(radius + 48, Math.max(radius + 48, stage.clientWidth - radius - 48)),
      y: randomBetween(radius + 48, Math.max(radius + 48, stage.clientHeight - radius - 48)),
    };

    const overlapsBubble = state.bubbles.some((bubble) => {
      const gap = Math.hypot(point.x - bubble.x, point.y - bubble.y);
      return gap < radius + bubble.radius + 22;
    });

    if (!overlapsBubble) {
      return point;
    }
  }

  return {
    x: stage.clientWidth / 2 + randomBetween(-80, 80),
    y: stage.clientHeight / 2 + randomBetween(-80, 80),
  };
}

function findOverlapTarget(sourceBubble) {
  let chosenTarget = null;
  let strongestOverlap = 0;
  const excludedIds = state.drag?.componentIds ?? new Set([sourceBubble.id]);

  for (const candidate of state.bubbles) {
    if (excludedIds.has(candidate.id)) {
      continue;
    }

    const distance = Math.hypot(sourceBubble.x - candidate.x, sourceBubble.y - candidate.y);
    const overlapAmount = sourceBubble.radius + candidate.radius - distance;

    if (overlapAmount > 8 && overlapAmount > strongestOverlap) {
      strongestOverlap = overlapAmount;
      chosenTarget = candidate;
    }
  }

  return chosenTarget;
}

function updatePreviewTarget(sourceBubble, targetBubble) {
  if (state.drag?.target && state.drag.target !== targetBubble) {
    state.drag.target.element.classList.remove("is-target");
  }

  state.drag.target = targetBubble;

  if (!targetBubble) {
    previewLine.style.display = "none";
    return;
  }

  targetBubble.element.classList.add("is-target");
  previewLine.style.display = "block";
  previewLine.setAttribute("x1", sourceBubble.x);
  previewLine.setAttribute("y1", sourceBubble.y);
  previewLine.setAttribute("x2", targetBubble.x);
  previewLine.setAttribute("y2", targetBubble.y);
}

function clearPreviewTarget() {
  if (state.drag?.target) {
    state.drag.target.element.classList.remove("is-target");
  }

  for (const bubble of state.bubbles) {
    bubble.element.classList.remove("is-target");
  }

  previewLine.style.display = "none";
}

function bubblesAreLinked(firstBubbleId, secondBubbleId) {
  return state.links.some((link) => {
    return (
      (link.a === firstBubbleId && link.b === secondBubbleId) ||
      (link.a === secondBubbleId && link.b === firstBubbleId)
    );
  });
}

function redrawLinks() {
  for (const link of state.links) {
    const firstBubble = state.bubbles.find((bubble) => bubble.id === link.a);
    const secondBubble = state.bubbles.find((bubble) => bubble.id === link.b);

    if (!firstBubble || !secondBubble) {
      continue;
    }

    link.element.setAttribute("x1", firstBubble.x);
    link.element.setAttribute("y1", firstBubble.y);
    link.element.setAttribute("x2", secondBubble.x);
    link.element.setAttribute("y2", secondBubble.y);
  }

  updateMinimap();
}

function requestAnimationLoop() {
  if (state.rafId) {
    return;
  }

  state.rafId = window.requestAnimationFrame(stepScene);
}

function stepScene(frameTime) {
  state.rafId = 0;
  const previousFrameTime = state.lastSceneTime || frameTime;
  const deltaSeconds = Math.min((frameTime - previousFrameTime) / 1000, 0.05);
  state.lastSceneTime = frameTime;
  const keepAnimating = updateBubbleDragPhysics(deltaSeconds, frameTime);
  redrawLinks();

  if (keepAnimating) {
    requestAnimationLoop();
    return;
  }

  state.lastSceneTime = 0;
}

function getBubbleById(bubbleId) {
  return state.bubbles.find((bubble) => bubble.id === bubbleId) || null;
}

function getBubblesByIds(bubbleIds) {
  return state.bubbles.filter((bubble) => bubbleIds.has(bubble.id));
}

function refreshBubbleSizes() {
  for (const bubble of state.bubbles) {
    updateBubbleSize(bubble, findParentBubble(bubble));
  }
}

function updateBubbleSize(bubble, parentBubble) {
  const stageMaxRadius = Math.min(stage.clientWidth, stage.clientHeight) * 0.18;
  let nextRadius = bubble.baseRadius;

  if (parentBubble) {
    const sisterCount = Math.max(parentBubble.children.size - 1, 0);
    const shrinkMultiplier = Math.pow(0.9, sisterCount);
    nextRadius = bubble.baseRadius * shrinkMultiplier;
    nextRadius = Math.min(nextRadius, parentBubble.radius);
  }

  nextRadius = clamp(nextRadius, 26, stageMaxRadius);

  bubble.radius = nextRadius;
  keepBubbleInBounds(bubble);
  renderBubble(bubble);
  fitBubbleText(bubble);
}

function findParentBubble(childBubble) {
  const parentLink = state.links.find((link) => link.childId === childBubble.id);
  if (!parentLink) {
    return null;
  }

  return getBubbleById(parentLink.parentId);
}

function clearBubbleClickTimer(bubble) {
  if (!bubble.clickTimerId) {
    return;
  }

  window.clearTimeout(bubble.clickTimerId);
  bubble.clickTimerId = 0;
}

function deleteBubble(bubbleToDelete) {
  clearBubbleClickTimer(bubbleToDelete);

  if (state.activeEditor === bubbleToDelete) {
    state.activeEditor = null;
  }

  bubbleToDelete.element.remove();

  for (const bubble of state.bubbles) {
    bubble.connections.delete(bubbleToDelete.id);
    bubble.children.delete(bubbleToDelete.id);
  }

  const remainingLinks = [];

  for (const link of state.links) {
    if (link.a === bubbleToDelete.id || link.b === bubbleToDelete.id) {
      link.element.remove();
      continue;
    }

    remainingLinks.push(link);
  }

  state.links = remainingLinks;
  state.bubbles = state.bubbles.filter((bubble) => bubble.id !== bubbleToDelete.id);
  state.selectedBubbleIds.delete(bubbleToDelete.id);
  if (state.selectedBubbleId === bubbleToDelete.id) {
    state.selectedBubbleId = state.selectedBubbleIds.values().next().value ?? null;
  }
  refreshBubbleSizes();
  toggleEmptyHint();
  redrawLinks();
}

function deleteSelectedBubbles() {
  const selectedIds = Array.from(state.selectedBubbleIds);

  for (const bubbleId of selectedIds) {
    const bubble = getBubbleById(bubbleId);
    if (bubble) {
      deleteBubble(bubble);
    }
  }
}

function setSelectedBubbles(bubbles) {
  clearSelectedBubbles();

  const bubbleList = bubbles.filter(Boolean);
  for (const bubble of bubbleList) {
    state.selectedBubbleIds.add(bubble.id);
    bubble.element.classList.add("is-selected");
  }

  state.selectedBubbleId = bubbleList[0]?.id ?? null;
}

function clearSelectedBubbles() {
  if (state.selectedBubbleIds.size === 0 && !state.selectedBubbleId) {
    return;
  }

  for (const bubbleId of state.selectedBubbleIds) {
    const bubble = getBubbleById(bubbleId);
    bubble?.element.classList.remove("is-selected");
  }

  state.selectedBubbleIds.clear();
  state.selectedBubbleId = null;
}

function toggleEmptyHint() {
  const started = hasStarted();
  emptyHint.classList.toggle("is-hidden", started);
  startupBrand.classList.toggle("is-hidden", started);
  zoomOutButton.disabled = !started;
  zoomInButton.disabled = !started;

  for (const panButton of panButtons) {
    panButton.disabled = !started;
  }
}

function hasStarted() {
  return state.hasEnteredApp;
}

function enterApp() {
  if (state.hasEnteredApp) {
    return;
  }

  state.hasEnteredApp = true;
  toggleEmptyHint();
}

function setZoom(nextZoom, options = {}) {
  if (options.revealViewport) {
    revealMinimapViewportPreview();
  }

  const clampedZoom = clamp(nextZoom, minZoom, maxZoom);

  if (clampedZoom === state.zoom) {
    return;
  }

  const stageRect = stage.getBoundingClientRect();
  const stageCenterX =
    options.clientX != null ? options.clientX - stageRect.left : stage.clientWidth * 0.5;
  const stageCenterY =
    options.clientY != null ? options.clientY - stageRect.top : stage.clientHeight * 0.5;
  const worldCenterX = (stageCenterX - state.panX) / state.zoom;
  const worldCenterY = (stageCenterY - state.panY) / state.zoom;

  state.zoom = clampedZoom;
  state.panX = stageCenterX - worldCenterX * state.zoom;
  state.panY = stageCenterY - worldCenterY * state.zoom;
  applyZoom();
}

function shouldIgnoreKeyboardShortcut(event) {
  if (state.activeEditor) {
    return true;
  }

  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function clearPressedWidgetKeys() {
  state.pressedKeys.clear();
  state.keyboardPanOrder = [];

  for (const bindingId of state.activeKeyBindings) {
    deactivateKeyboardBinding(bindingId);
  }

  state.activeKeyBindings.clear();
}

function syncKeyboardBindings() {
  const nextBindings = getActiveKeyboardBindings();

  for (const bindingId of state.activeKeyBindings) {
    if (!nextBindings.has(bindingId)) {
      deactivateKeyboardBinding(bindingId);
    }
  }

  for (const bindingId of nextBindings) {
    if (!state.activeKeyBindings.has(bindingId)) {
      activateKeyboardBinding(bindingId);
    }
  }

  state.activeKeyBindings = nextBindings;
}

function getActiveKeyboardBindings() {
  const bindings = new Set();
  const hasShift = state.pressedKeys.has("ShiftLeft") || state.pressedKeys.has("ShiftRight");

  if (state.pressedKeys.has("KeyW")) bindings.add("triangle");
  if (state.pressedKeys.has("KeyD")) bindings.add("circle");
  if (state.pressedKeys.has("KeyS")) bindings.add("x");
  if (state.pressedKeys.has("KeyA")) bindings.add("square");
  if (state.pressedKeys.has("ArrowUp")) bindings.add("dpadUp");
  if (state.pressedKeys.has("ArrowLeft")) bindings.add("dpadLeft");
  if (state.pressedKeys.has("ArrowRight")) bindings.add("dpadRight");
  if (state.pressedKeys.has("ArrowDown")) bindings.add("dpadDown");

  if (state.pressedKeys.has("KeyQ")) {
    bindings.add(hasShift ? "l2" : "l1");
  }

  if (state.pressedKeys.has("KeyE")) {
    bindings.add(hasShift ? "r2" : "r1");
  }

  return bindings;
}

function activateKeyboardBinding(bindingId) {
  keyBoundButtons[bindingId]?.classList.add("is-active");

  if (bindingId === "triangle") {
    setZoom(state.zoom + zoomStep, { revealViewport: true });
    return;
  }

  if (bindingId === "circle") {
    circleButton.click();
    return;
  }

  if (bindingId === "x") {
    setZoom(state.zoom - zoomStep, { revealViewport: true });
    return;
  }

  if (bindingId === "square") {
    squareButton.click();
    return;
  }

  if (bindingId.startsWith("dpad")) {
    state.keyboardPanOrder = state.keyboardPanOrder.filter((item) => item !== bindingId);
    state.keyboardPanOrder.push(bindingId);
    refreshKeyboardPan();
  }
}

function deactivateKeyboardBinding(bindingId) {
  keyBoundButtons[bindingId]?.classList.remove("is-active");

  if (bindingId.startsWith("dpad")) {
    state.keyboardPanOrder = state.keyboardPanOrder.filter((item) => item !== bindingId);
    refreshKeyboardPan();
  }
}

function refreshKeyboardPan() {
  const activeBinding = state.keyboardPanOrder.at(-1);

  if (!activeBinding) {
    stopManualPan();
    return;
  }

  if (activeBinding === "dpadUp") {
    startManualPan("up", dpadUpButton);
  } else if (activeBinding === "dpadLeft") {
    startManualPan("left", dpadLeftButton);
  } else if (activeBinding === "dpadRight") {
    startManualPan("right", dpadRightButton);
  } else if (activeBinding === "dpadDown") {
    startManualPan("down", dpadDownButton);
  }
}

function beginAnalogStickDrag(event, analogStick) {
  const base = analogStick.parentElement;

  if (!base) {
    return;
  }

  const baseRect = base.getBoundingClientRect();
  const centerX = baseRect.left + baseRect.width / 2;
  const centerY = baseRect.top + baseRect.height / 2;
  const computedStyles = window.getComputedStyle(base);
  const radiusValue = computedStyles.getPropertyValue("--analog-travel-radius").trim();
  const radius = Number.parseFloat(radiusValue) || 18;

  state.analogDrag = {
    pointerId: event.pointerId,
    analogStick,
    centerX,
    centerY,
    radius,
  };

  analogStick.classList.add("is-dragging");
  analogStick.setPointerCapture(event.pointerId);
  document.addEventListener("pointermove", handleAnalogStickDrag);
  document.addEventListener("pointerup", endAnalogStickDrag);
  document.addEventListener("pointercancel", endAnalogStickDrag);
  updateAnalogStickPosition(event.clientX, event.clientY);
}

function handleAnalogStickDrag(event) {
  if (!state.analogDrag || event.pointerId !== state.analogDrag.pointerId) {
    return;
  }

  updateAnalogStickPosition(event.clientX, event.clientY);
}

function endAnalogStickDrag(event) {
  if (!state.analogDrag || event.pointerId !== state.analogDrag.pointerId) {
    return;
  }

  const { analogStick } = state.analogDrag;
  if (analogStick.hasPointerCapture(event.pointerId)) {
    analogStick.releasePointerCapture(event.pointerId);
  }
  document.removeEventListener("pointermove", handleAnalogStickDrag);
  document.removeEventListener("pointerup", endAnalogStickDrag);
  document.removeEventListener("pointercancel", endAnalogStickDrag);
  analogStick.classList.remove("is-dragging");
  analogStick.style.setProperty("--stick-offset-x", "0px");
  analogStick.style.setProperty("--stick-offset-y", "0px");
  state.analogDrag = null;
}

function updateAnalogStickPosition(clientX, clientY) {
  const { analogStick, centerX, centerY, radius } = state.analogDrag;
  let offsetX = clientX - centerX;
  let offsetY = clientY - centerY;
  const distance = Math.hypot(offsetX, offsetY);

  if (distance > radius) {
    const scale = radius / distance;
    offsetX *= scale;
    offsetY *= scale;
  }

  analogStick.style.setProperty("--stick-offset-x", `${offsetX}px`);
  analogStick.style.setProperty("--stick-offset-y", `${offsetY}px`);
}

function startManualPan(direction, button) {
  if (!hasStarted()) {
    return;
  }

  stopManualPan();
  state.panIntent = direction;
  button.classList.add("is-active");
  revealMinimapViewportPreview();
  state.panLastFrame = performance.now();
  if (!state.panRafId) {
    state.panRafId = window.requestAnimationFrame(stepManualPan);
  }
}

function stopManualPan() {
  state.panIntent = null;
  for (const panButton of panButtons) {
    panButton.classList.remove("is-active");
  }
  if (state.panRafId) {
    window.cancelAnimationFrame(state.panRafId);
    state.panRafId = 0;
  }
}

function stepManualPan(frameTime) {
  if (!state.panIntent) {
    state.panRafId = 0;
    return;
  }

  const deltaSeconds = Math.min((frameTime - state.panLastFrame) / 1000, 0.05);
  state.panLastFrame = frameTime;
  const distance = manualPanSpeed * deltaSeconds;

  if (state.panIntent === "up") {
    state.panY += distance;
  } else if (state.panIntent === "down") {
    state.panY -= distance;
  } else if (state.panIntent === "left") {
    state.panX += distance;
  } else if (state.panIntent === "right") {
    state.panX -= distance;
  }

  applyZoom({ revealViewport: true });
  state.panRafId = window.requestAnimationFrame(stepManualPan);
}

function applyZoom(options = {}) {
  stageViewport.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  updateMinimap();

  if (options.revealViewport) {
    revealMinimapViewportPreview();
  }
}

function revealMinimapViewportPreview() {
  minimapViewport.classList.add("is-visible");

  if (state.viewportPreviewTimerId) {
    window.clearTimeout(state.viewportPreviewTimerId);
  }

  state.viewportPreviewTimerId = window.setTimeout(() => {
    state.viewportPreviewTimerId = 0;
    hideMinimapViewportPreview();
  }, 500);
}

function hideMinimapViewportPreview() {
  if (state.viewportPreviewTimerId) {
    window.clearTimeout(state.viewportPreviewTimerId);
    state.viewportPreviewTimerId = 0;
  }
  if (state.minimapDrag) {
    return;
  }
  minimapViewport.classList.remove("is-visible");
}

function clientPointToWorld(clientX, clientY) {
  const stageRect = stage.getBoundingClientRect();
  return {
    x: (clientX - stageRect.left - state.panX) / state.zoom,
    y: (clientY - stageRect.top - state.panY) / state.zoom,
  };
}

function beginMarqueeSelection(event) {
  const stageRect = stage.getBoundingClientRect();
  const marquee = {
    pointerId: event.pointerId,
    startLocalX: event.clientX - stageRect.left,
    startLocalY: event.clientY - stageRect.top,
    localX: event.clientX - stageRect.left,
    localY: event.clientY - stageRect.top,
    moved: false,
  };

  state.marqueeSelection = marquee;
  stage.setPointerCapture(event.pointerId);
  stage.addEventListener("pointermove", handleMarqueeSelectionMove);
  stage.addEventListener("pointerup", endMarqueeSelection);
  stage.addEventListener("pointercancel", endMarqueeSelection);
}

function handleMarqueeSelectionMove(event) {
  if (!state.marqueeSelection || event.pointerId !== state.marqueeSelection.pointerId) {
    return;
  }

  const stageRect = stage.getBoundingClientRect();
  const localX = clamp(event.clientX - stageRect.left, 0, stageRect.width);
  const localY = clamp(event.clientY - stageRect.top, 0, stageRect.height);
  const marquee = state.marqueeSelection;
  marquee.localX = localX;
  marquee.localY = localY;

  if (!marquee.moved) {
    const movedDistance = Math.hypot(localX - marquee.startLocalX, localY - marquee.startLocalY);
    if (movedDistance > 6) {
      marquee.moved = true;
    }
  }

  if (!marquee.moved) {
    return;
  }

  renderMarqueeSelection();
  updateMarqueeSelectionBubbles();
}

function endMarqueeSelection(event) {
  if (!state.marqueeSelection || event.pointerId !== state.marqueeSelection.pointerId) {
    return;
  }

  stage.releasePointerCapture(event.pointerId);
  stage.removeEventListener("pointermove", handleMarqueeSelectionMove);
  stage.removeEventListener("pointerup", endMarqueeSelection);
  stage.removeEventListener("pointercancel", endMarqueeSelection);

  if (!state.marqueeSelection.moved) {
    clearSelectedBubbles();
  }

  hideMarqueeSelection();
  state.marqueeSelection = null;
}

function renderMarqueeSelection() {
  if (!state.marqueeSelection) {
    return;
  }

  const marquee = state.marqueeSelection;
  const left = Math.min(marquee.startLocalX, marquee.localX);
  const top = Math.min(marquee.startLocalY, marquee.localY);
  const width = Math.abs(marquee.localX - marquee.startLocalX);
  const height = Math.abs(marquee.localY - marquee.startLocalY);

  selectionMarquee.style.left = `${left}px`;
  selectionMarquee.style.top = `${top}px`;
  selectionMarquee.style.width = `${width}px`;
  selectionMarquee.style.height = `${height}px`;
  selectionMarquee.classList.add("is-visible");
}

function hideMarqueeSelection() {
  selectionMarquee.classList.remove("is-visible");
  selectionMarquee.style.width = "0px";
  selectionMarquee.style.height = "0px";
}

function updateMarqueeSelectionBubbles() {
  if (!state.marqueeSelection) {
    return;
  }

  const marquee = state.marqueeSelection;
  const firstWorld = clientPointToWorldFromStageLocal(marquee.startLocalX, marquee.startLocalY);
  const secondWorld = clientPointToWorldFromStageLocal(marquee.localX, marquee.localY);
  const minX = Math.min(firstWorld.x, secondWorld.x);
  const minY = Math.min(firstWorld.y, secondWorld.y);
  const maxX = Math.max(firstWorld.x, secondWorld.x);
  const maxY = Math.max(firstWorld.y, secondWorld.y);
  const selectedBubbles = state.bubbles.filter((bubble) => {
    const bubbleMinX = bubble.x - bubble.radius;
    const bubbleMaxX = bubble.x + bubble.radius;
    const bubbleMinY = bubble.y - bubble.radius;
    const bubbleMaxY = bubble.y + bubble.radius;

    return (
      bubbleMinX >= minX &&
      bubbleMaxX <= maxX &&
      bubbleMinY >= minY &&
      bubbleMaxY <= maxY
    );
  });

  setSelectedBubbles(selectedBubbles);
}

function clientPointToWorldFromStageLocal(localX, localY) {
  return {
    x: (localX - state.panX) / state.zoom,
    y: (localY - state.panY) / state.zoom,
  };
}

function getConnectedBubbleIds(startBubbleId) {
  const visitedBubbleIds = new Set([startBubbleId]);
  const bubbleQueue = [startBubbleId];

  while (bubbleQueue.length > 0) {
    const currentBubbleId = bubbleQueue.shift();
    const currentBubble = getBubbleById(currentBubbleId);

    if (!currentBubble) {
      continue;
    }

    for (const neighborBubbleId of currentBubble.connections) {
      if (visitedBubbleIds.has(neighborBubbleId)) {
        continue;
      }

      visitedBubbleIds.add(neighborBubbleId);
      bubbleQueue.push(neighborBubbleId);
    }
  }

  return visitedBubbleIds;
}

function updateMinimap() {
  if (!minimapFrame) {
    return;
  }

  const bounds = getSceneBounds();
  state.minimapBounds = bounds;
  minimapLinks.replaceChildren();
  minimapBubbles.replaceChildren();

  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  const mapX = (worldX) => ((worldX - bounds.minX) / width) * 100;
  const mapY = (worldY) => ((worldY - bounds.minY) / height) * 100;

  for (const link of state.links) {
    const firstBubble = getBubbleById(link.a);
    const secondBubble = getBubbleById(link.b);

    if (!firstBubble || !secondBubble) {
      continue;
    }

    const line = document.createElementNS(svgNamespace, "line");
    line.setAttribute("class", "minimap-link");
    line.setAttribute("x1", mapX(firstBubble.x));
    line.setAttribute("y1", mapY(firstBubble.y));
    line.setAttribute("x2", mapX(secondBubble.x));
    line.setAttribute("y2", mapY(secondBubble.y));
    minimapLinks.appendChild(line);
  }

  for (const bubble of state.bubbles) {
    const circle = document.createElementNS(svgNamespace, "circle");
    const parentBubble = findParentBubble(bubble);
    const mapRadius = clamp((bubble.radius / Math.max(width, height)) * 100, 1.8, 6.5);
    circle.setAttribute("class", `minimap-bubble${parentBubble ? "" : " is-root"}`);
    circle.setAttribute("cx", mapX(bubble.x));
    circle.setAttribute("cy", mapY(bubble.y));
    circle.setAttribute("r", mapRadius);
    minimapBubbles.appendChild(circle);
  }

  const visibleWorld = getVisibleWorldRect();
  const viewportWidth = Math.min((visibleWorld.width / width) * 100, 100);
  const viewportHeight = Math.min((visibleWorld.height / height) * 100, 100);
  const viewportX = clamp(mapX(visibleWorld.minX), 0, Math.max(0, 100 - viewportWidth));
  const viewportY = clamp(mapY(visibleWorld.minY), 0, Math.max(0, 100 - viewportHeight));
  minimapViewport.setAttribute("x", viewportX);
  minimapViewport.setAttribute("y", viewportY);
  minimapViewport.setAttribute("width", viewportWidth);
  minimapViewport.setAttribute("height", viewportHeight);
}

function getVisibleWorldRect() {
  return {
    minX: -state.panX / state.zoom,
    minY: -state.panY / state.zoom,
    width: stage.clientWidth / state.zoom,
    height: stage.clientHeight / state.zoom,
  };
}

function getSceneBounds() {
  const visibleWorld = getVisibleWorldRect();
  const stageWidth = stage.clientWidth || 1;
  const stageHeight = stage.clientHeight || 1;
  let minX = Math.min(0, visibleWorld.minX);
  let minY = Math.min(0, visibleWorld.minY);
  let maxX = Math.max(stageWidth, visibleWorld.minX + visibleWorld.width);
  let maxY = Math.max(stageHeight, visibleWorld.minY + visibleWorld.height);
  const margin = 64;

  for (const bubble of state.bubbles) {
    minX = Math.min(minX, bubble.x - bubble.radius - margin);
    minY = Math.min(minY, bubble.y - bubble.radius - margin);
    maxX = Math.max(maxX, bubble.x + bubble.radius + margin);
    maxY = Math.max(maxY, bubble.y + bubble.radius + margin);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function navigateFromMinimap(clientX, clientY) {
  const rect = minimapFrame.getBoundingClientRect();
  const ratioX = clamp((clientX - rect.left) / rect.width, 0, 1);
  const ratioY = clamp((clientY - rect.top) / rect.height, 0, 1);
  const bounds = state.minimapBounds ?? getSceneBounds();
  const targetX = bounds.minX + bounds.width * ratioX;
  const targetY = bounds.minY + bounds.height * ratioY;

  state.panX = stage.clientWidth * 0.5 - targetX * state.zoom;
  state.panY = stage.clientHeight * 0.5 - targetY * state.zoom;
  applyZoom();
}

function beginMinimapViewportDrag(event) {
  revealMinimapViewportPreview();
  const rect = minimapFrame.getBoundingClientRect();
  const pointerX = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
  const pointerY = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);
  const viewportX = Number(minimapViewport.getAttribute("x")) || 0;
  const viewportY = Number(minimapViewport.getAttribute("y")) || 0;

  state.minimapDrag = {
    pointerId: event.pointerId,
    offsetX: pointerX - viewportX,
    offsetY: pointerY - viewportY,
    moved: false,
  };

  minimapViewport.setPointerCapture(event.pointerId);
  minimapViewport.addEventListener("pointermove", handleMinimapViewportDrag);
  minimapViewport.addEventListener("pointerup", endMinimapViewportDrag);
  minimapViewport.addEventListener("pointercancel", endMinimapViewportDrag);
}

function handleMinimapViewportDrag(event) {
  if (!state.minimapDrag || event.pointerId !== state.minimapDrag.pointerId) {
    return;
  }

  const rect = minimapFrame.getBoundingClientRect();
  const pointerX = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
  const pointerY = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);
  const viewportWidth = Number(minimapViewport.getAttribute("width")) || 0;
  const viewportHeight = Number(minimapViewport.getAttribute("height")) || 0;
  const targetX = clamp(pointerX - state.minimapDrag.offsetX, 0, Math.max(0, 100 - viewportWidth));
  const targetY = clamp(pointerY - state.minimapDrag.offsetY, 0, Math.max(0, 100 - viewportHeight));
  const bounds = state.minimapBounds ?? getSceneBounds();
  const worldMinX = bounds.minX + (targetX / 100) * bounds.width;
  const worldMinY = bounds.minY + (targetY / 100) * bounds.height;

  state.minimapDrag.moved = true;
  state.suppressMinimapClick = true;
  setViewportTopLeft(worldMinX, worldMinY);
}

function endMinimapViewportDrag(event) {
  if (!state.minimapDrag || event.pointerId !== state.minimapDrag.pointerId) {
    return;
  }

  minimapViewport.releasePointerCapture(event.pointerId);
  minimapViewport.removeEventListener("pointermove", handleMinimapViewportDrag);
  minimapViewport.removeEventListener("pointerup", endMinimapViewportDrag);
  minimapViewport.removeEventListener("pointercancel", endMinimapViewportDrag);
  state.minimapDrag = null;
  hideMinimapViewportPreview();
}

function setViewportTopLeft(worldMinX, worldMinY) {
  state.panX = -worldMinX * state.zoom;
  state.panY = -worldMinY * state.zoom;
  applyZoom();
}

function placeCaretAtEnd(element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectTextContents(element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

toggleEmptyHint();
applyZoom();
