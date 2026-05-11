const svgNamespace = "http://www.w3.org/2000/svg";
const stage = document.getElementById("widget-stage");
const stageViewport = document.getElementById("stage-viewport");
const bubbleLayer = document.getElementById("bubble-layer");
const linkLayer = document.getElementById("link-layer");
const previewLine = document.getElementById("link-preview");
const startupBrand = document.getElementById("startup-brand");
const emptyHint = document.getElementById("empty-hint");
const deleteTarget = document.getElementById("delete-target");
const minimapFrame = document.getElementById("minimap-frame");
const minimapLinks = document.getElementById("minimap-links");
const minimapBubbles = document.getElementById("minimap-bubbles");
const minimapViewport = document.getElementById("minimap-viewport");
const zoomOutButton = document.getElementById("zoom-out");
const zoomInButton = document.getElementById("zoom-in");
const panButtons = Array.from(document.querySelectorAll("[data-pan-direction]"));

const state = {
  bubbles: [],
  links: [],
  nextBubbleId: 1,
  nextLinkId: 1,
  drag: null,
  activeEditor: null,
  rafId: 0,
  lastFrame: performance.now(),
  panIntent: null,
  panRafId: 0,
  panLastFrame: 0,
  panX: 0,
  panY: 0,
  zoom: 1,
  minimapBounds: null,
  minimapDrag: null,
  suppressMinimapClick: false,
};

const zoomStep = 0.15;
const minZoom = 0.7;
const maxZoom = 1.8;
const manualPanSpeed = 520;

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

stage.addEventListener("dblclick", (event) => {
  if (event.target.closest(".bubble") || event.target.closest(".control-cluster")) {
    return;
  }

  createBubble(clientPointToWorld(event.clientX, event.clientY));
  requestAnimationLoop();
});

stage.addEventListener(
  "wheel",
  (event) => {
    if (!hasStarted()) {
      return;
    }

    if (event.ctrlKey) {
      return;
    }

    event.preventDefault();
    state.panX -= event.deltaX;
    state.panY -= event.deltaY;
    applyZoom();
  },
  { passive: false }
);

zoomOutButton.addEventListener("click", () => {
  if (!hasStarted()) {
    return;
  }

  setZoom(state.zoom - zoomStep);
});

zoomInButton.addEventListener("click", () => {
  if (!hasStarted()) {
    return;
  }

  setZoom(state.zoom + zoomStep);
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

function createBubble(options = {}) {
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
    vx: randomBetween(-1.8, 1.8),
    vy: randomBetween(-1.4, 1.4),
    element,
    label,
    connections: new Set(),
    children: new Set(),
    clickTimerId: 0,
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

  element.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearBubbleClickTimer(bubble);
    createLinkedChildBubble(bubble);
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

    queueBubbleEdit(bubble);
  };

  bubble.element.addEventListener("pointermove", handleMove);
  bubble.element.addEventListener("pointerup", handleEnd);
  bubble.element.addEventListener("pointercancel", handleEnd);
}

function beginDrag(interaction, event) {
  const bubble = interaction.bubble;
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
    componentIds,
    linkLengths: captureComponentLinkLengths(componentIds),
    deleteArmed: false,
    target: null,
  };
  clearBubbleClickTimer(bubble);
  toggleDeleteTarget(true);
  dragBubble(event);
}

function endDrag() {
  if (!state.drag) {
    return;
  }

  const { bubble, target } = state.drag;
  bubble.element.classList.remove("is-dragging");

  if (state.drag.deleteArmed) {
    deleteBubble(bubble);
  } else if (target) {
    createLink(state.drag.bubble, target);
  }

  clearPreviewTarget();
  toggleDeleteTarget(false);
  state.drag = null;
  requestAnimationLoop();
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
  renderBubble(bubble);

  const velocityX = (event.clientX - drag.lastClientX) * 0.18;
  const velocityY = (event.clientY - drag.lastClientY) * 0.18;

  bubble.vx = velocityX;
  bubble.vy = velocityY;

  drag.lastClientX = event.clientX;
  drag.lastClientY = event.clientY;

  drag.deleteArmed = isBubbleOverDeleteTarget(bubble);
  updateDeleteTargetState(drag.deleteArmed);

  if (drag.deleteArmed) {
    clearPreviewTarget();
  } else {
    redrawLinks();
    const overlapTarget = findOverlapTarget(bubble);
    updatePreviewTarget(bubble, overlapTarget);
  }
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

  separateLinkedBubbles(childBubble, parentBubble);
  untangleLinks(18);

  redrawLinks();
  requestAnimationLoop();
}

function separateLinkedBubbles(childBubble, parentBubble) {
  const dx = childBubble.x - parentBubble.x;
  const dy = childBubble.y - parentBubble.y;
  const distance = Math.hypot(dx, dy) || 1;
  const normalX = dx / distance;
  const normalY = dy / distance;
  const targetDistance = childBubble.radius + parentBubble.radius + 28;

  childBubble.x = parentBubble.x + normalX * targetDistance;
  childBubble.y = parentBubble.y + normalY * targetDistance;
  childBubble.vx += normalX * 1.25;
  childBubble.vy += normalY * 1.25;

  keepBubbleInBounds(childBubble);
  keepBubbleInBounds(parentBubble);
  renderBubble(childBubble);
  renderBubble(parentBubble);
}

function startEditing(bubble) {
  if (state.activeEditor && state.activeEditor !== bubble) {
    state.activeEditor.label.blur();
  }

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
  const delta = Math.min((frameTime - state.lastFrame) / 16.667, 2.2);
  state.lastFrame = frameTime;
  state.rafId = 0;

  applyBubbleMotion(frameTime, delta);
  applyDraggedChainFollow(delta);
  applyChainLayout(delta);
  resolveLinkCrossings(delta);
  solveCollisions();
  redrawLinks();

  if (sceneStillMoving()) {
    requestAnimationLoop();
  }
}

function applyBubbleMotion(frameTime, delta) {
  const draggedBubbleId = state.drag?.bubble.id ?? null;

  for (const bubble of state.bubbles) {
    if (bubble.id === draggedBubbleId || bubble.isEditing) {
      continue;
    }

    bubble.vx *= 0.9;
    bubble.vy *= 0.94;
    bubble.x += bubble.vx * delta;
    bubble.y += bubble.vy * delta;

    keepBubbleInBounds(bubble);
    renderBubble(bubble);
  }
}

function applyDraggedChainFollow(delta) {
  if (!state.drag) {
    return;
  }

  const drag = state.drag;
  const rootBubble = drag.bubble;
  const rootPullX = drag.targetX - rootBubble.x;
  const rootPullY = drag.targetY - rootBubble.y;

  rootBubble.vx += rootPullX * 0.18 * delta;
  rootBubble.vy += rootPullY * 0.18 * delta;
  rootBubble.x += rootBubble.vx * delta;
  rootBubble.y += rootBubble.vy * delta;
  rootBubble.vx *= 0.72;
  rootBubble.vy *= 0.72;
  keepBubbleInBounds(rootBubble);
  renderBubble(rootBubble);

  for (const link of state.links) {
    if (!drag.componentIds.has(link.a) || !drag.componentIds.has(link.b)) {
      continue;
    }

    const firstBubble = getBubbleById(link.a);
    const secondBubble = getBubbleById(link.b);

    if (!firstBubble || !secondBubble) {
      continue;
    }

    const targetDistance =
      drag.linkLengths.get(link.id) ?? firstBubble.radius + secondBubble.radius + 28;
    const dx = secondBubble.x - firstBubble.x;
    const dy = secondBubble.y - firstBubble.y;
    const distance = Math.hypot(dx, dy) || 0.0001;
    const stretch = distance - targetDistance;
    const normalX = dx / distance;
    const normalY = dy / distance;
    const springForce = stretch * 0.018 * delta;

    if (firstBubble.id !== rootBubble.id) {
      firstBubble.vx += normalX * springForce;
      firstBubble.vy += normalY * springForce;
    }

    if (secondBubble.id !== rootBubble.id) {
      secondBubble.vx -= normalX * springForce;
      secondBubble.vy -= normalY * springForce;
    }
  }

  for (const bubble of state.bubbles) {
    if (!drag.componentIds.has(bubble.id) || bubble.id === rootBubble.id) {
      continue;
    }

    bubble.vx *= 0.86;
    bubble.vy *= 0.86;
    bubble.x += bubble.vx * delta;
    bubble.y += bubble.vy * delta;
    keepBubbleInBounds(bubble);
    renderBubble(bubble);
  }
}

function applyChainLayout(delta) {
  const draggedIds = state.drag?.componentIds ?? new Set();
  const parentChildrenMap = new Map();

  for (const link of state.links) {
    const parentBubble = getBubbleById(link.parentId);
    const childBubble = getBubbleById(link.childId);

    if (!parentBubble || !childBubble) {
      continue;
    }

    if (!parentChildrenMap.has(parentBubble.id)) {
      parentChildrenMap.set(parentBubble.id, []);
    }

    parentChildrenMap.get(parentBubble.id).push(childBubble);
  }

  for (const [parentId, children] of parentChildrenMap.entries()) {
    const parentBubble = getBubbleById(parentId);

    if (!parentBubble) {
      continue;
    }

    const sortedChildren = children.slice().sort((firstBubble, secondBubble) => {
      return Math.abs(firstBubble.x - parentBubble.x) - Math.abs(secondBubble.x - parentBubble.x);
    });
    const centerIndex = (sortedChildren.length - 1) / 2;

    sortedChildren.forEach((childBubble, index) => {
      if (draggedIds.has(parentBubble.id) || draggedIds.has(childBubble.id)) {
        return;
      }

      const slot = index - centerIndex;
      const row = Math.floor(index / 5);
      const targetX = parentBubble.x + slot * 10;
      const targetY =
        parentBubble.y +
        parentBubble.radius +
        childBubble.radius +
        28 +
        row * (childBubble.radius * 0.65);
      const offsetX = targetX - childBubble.x;
      const offsetY = targetY - childBubble.y;

      childBubble.vx += offsetX * 0.008 * delta;
      childBubble.vy += offsetY * 0.011 * delta;
      parentBubble.vx -= offsetX * 0.0008 * delta;
    });
  }
}

function resolveLinkCrossings(delta) {
  if (state.links.length < 2) {
    return;
  }

  const draggedIds = state.drag?.componentIds ?? new Set();

  for (let index = 0; index < state.links.length; index += 1) {
    const firstLink = state.links[index];

    for (let nextIndex = index + 1; nextIndex < state.links.length; nextIndex += 1) {
      const secondLink = state.links[nextIndex];

      if (linksShareEndpoint(firstLink, secondLink)) {
        continue;
      }

      const firstStart = getBubbleById(firstLink.a);
      const firstEnd = getBubbleById(firstLink.b);
      const secondStart = getBubbleById(secondLink.a);
      const secondEnd = getBubbleById(secondLink.b);

      if (!firstStart || !firstEnd || !secondStart || !secondEnd) {
        continue;
      }

      if (
        !segmentsIntersect(firstStart.x, firstStart.y, firstEnd.x, firstEnd.y, secondStart.x, secondStart.y, secondEnd.x, secondEnd.y)
      ) {
        continue;
      }

      applyCrossingSeparation(firstLink, secondLink, draggedIds, delta);
    }
  }
}

function applyCrossingSeparation(firstLink, secondLink, draggedIds, delta) {
  const firstParent = getBubbleById(firstLink.parentId);
  const firstChild = getBubbleById(firstLink.childId);
  const secondParent = getBubbleById(secondLink.parentId);
  const secondChild = getBubbleById(secondLink.childId);

  if (!firstParent || !firstChild || !secondParent || !secondChild) {
    return;
  }

  const push = 0.9 * delta;
  const firstShouldGoLeft = firstChild.x <= secondChild.x;
  const horizontalDirection = firstShouldGoLeft ? -1 : 1;

  nudgeBubble(firstChild, horizontalDirection * push, push * 0.38, draggedIds);
  nudgeBubble(secondChild, -horizontalDirection * push, push * 0.38, draggedIds);
  nudgeBubble(firstParent, -horizontalDirection * push * 0.24, 0, draggedIds);
  nudgeBubble(secondParent, horizontalDirection * push * 0.24, 0, draggedIds);
}

function solveCollisions() {
  const draggedComponentIds = state.drag?.componentIds ?? new Set();

  for (let index = 0; index < state.bubbles.length; index += 1) {
    const firstBubble = state.bubbles[index];

    for (let nextIndex = index + 1; nextIndex < state.bubbles.length; nextIndex += 1) {
      const secondBubble = state.bubbles[nextIndex];

      // While a chain is being dragged, let that connected group overlap others so links can be made.
      if (draggedComponentIds.has(firstBubble.id) || draggedComponentIds.has(secondBubble.id)) {
        continue;
      }

      const dx = secondBubble.x - firstBubble.x;
      const dy = secondBubble.y - firstBubble.y;
      const distance = Math.hypot(dx, dy) || 0.0001;
      const minimumGap = firstBubble.radius + secondBubble.radius + 18;

      if (distance >= minimumGap) {
        continue;
      }

      const overlap = minimumGap - distance;
      const normalX = dx / distance;
      const normalY = dy / distance;

      firstBubble.x -= normalX * overlap * 0.5;
      firstBubble.y -= normalY * overlap * 0.5;
      secondBubble.x += normalX * overlap * 0.5;
      secondBubble.y += normalY * overlap * 0.5;

      firstBubble.vx -= normalX * overlap * 0.015;
      firstBubble.vy -= normalY * overlap * 0.015;
      secondBubble.vx += normalX * overlap * 0.015;
      secondBubble.vy += normalY * overlap * 0.015;

      keepBubbleInBounds(firstBubble);
      keepBubbleInBounds(secondBubble);
      renderBubble(firstBubble);
      renderBubble(secondBubble);
    }
  }
}

function untangleLinks(iterations) {
  for (let index = 0; index < iterations; index += 1) {
    resolveLinkCrossings(1.6);
    solveCollisions();
  }

  redrawLinks();
}

function getBubbleById(bubbleId) {
  return state.bubbles.find((bubble) => bubble.id === bubbleId) || null;
}

function getBubblesByIds(bubbleIds) {
  return state.bubbles.filter((bubble) => bubbleIds.has(bubble.id));
}

function captureComponentLinkLengths(componentIds) {
  const linkLengths = new Map();

  for (const link of state.links) {
    if (!componentIds.has(link.a) || !componentIds.has(link.b)) {
      continue;
    }

    const firstBubble = getBubbleById(link.a);
    const secondBubble = getBubbleById(link.b);

    if (!firstBubble || !secondBubble) {
      continue;
    }

    linkLengths.set(link.id, Math.hypot(secondBubble.x - firstBubble.x, secondBubble.y - firstBubble.y));
  }

  return linkLengths;
}

function createLinkedChildBubble(parentBubble) {
  const angle = Math.random() * Math.PI * 2;
  const distance = parentBubble.radius + 108;
  const childBubble = createBubble({
    x: parentBubble.x + Math.cos(angle) * distance,
    y: parentBubble.y + Math.sin(angle) * distance,
  });

  keepBubbleInBounds(childBubble);
  renderBubble(childBubble);
  createLink(childBubble, parentBubble);
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

function queueBubbleEdit(bubble) {
  clearBubbleClickTimer(bubble);
  bubble.clickTimerId = window.setTimeout(() => {
    bubble.clickTimerId = 0;
    startEditing(bubble);
  }, 220);
}

function clearBubbleClickTimer(bubble) {
  if (!bubble.clickTimerId) {
    return;
  }

  window.clearTimeout(bubble.clickTimerId);
  bubble.clickTimerId = 0;
}

function toggleDeleteTarget(isVisible) {
  deleteTarget.classList.toggle("is-visible", isVisible);
  if (!isVisible) {
    deleteTarget.classList.remove("is-armed");
  }
}

function updateDeleteTargetState(isArmed) {
  deleteTarget.classList.toggle("is-armed", isArmed);
}

function isBubbleOverDeleteTarget(bubble) {
  const stageRect = stage.getBoundingClientRect();
  const deleteRect = deleteTarget.getBoundingClientRect();
  const bubbleCenterX = stageRect.left + bubble.x;
  const bubbleCenterY = stageRect.top + bubble.y;
  const deleteCenterX = deleteRect.left + deleteRect.width / 2;
  const deleteCenterY = deleteRect.top + deleteRect.height / 2;
  const activationRadius = bubble.radius + deleteRect.width * 0.42;

  return Math.hypot(bubbleCenterX - deleteCenterX, bubbleCenterY - deleteCenterY) <= activationRadius;
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
  refreshBubbleSizes();
  toggleEmptyHint();
  redrawLinks();
}

function toggleEmptyHint() {
  const started = hasStarted();
  emptyHint.classList.toggle("is-hidden", started);
  startupBrand.classList.toggle("is-hidden", started);
  minimapFrame.classList.toggle("is-disabled", !started);
  minimapFrame.setAttribute("aria-disabled", started ? "false" : "true");
  zoomOutButton.disabled = !started;
  zoomInButton.disabled = !started;

  for (const panButton of panButtons) {
    panButton.disabled = !started;
  }
}

function hasStarted() {
  return state.bubbles.length > 0;
}

function setZoom(nextZoom) {
  const clampedZoom = clamp(nextZoom, minZoom, maxZoom);

  if (clampedZoom === state.zoom) {
    return;
  }

  const stageCenterX = stage.clientWidth * 0.5;
  const stageCenterY = stage.clientHeight * 0.5;
  const worldCenterX = (stageCenterX - state.panX) / state.zoom;
  const worldCenterY = (stageCenterY - state.panY) / state.zoom;

  state.zoom = clampedZoom;
  state.panX = stageCenterX - worldCenterX * state.zoom;
  state.panY = stageCenterY - worldCenterY * state.zoom;
  applyZoom();
}

function startManualPan(direction, button) {
  if (!hasStarted()) {
    return;
  }

  stopManualPan();
  state.panIntent = direction;
  button.classList.add("is-active");
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

  applyZoom();
  state.panRafId = window.requestAnimationFrame(stepManualPan);
}

function applyZoom() {
  stageViewport.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  updateMinimap();
}

function clientPointToWorld(clientX, clientY) {
  const stageRect = stage.getBoundingClientRect();
  return {
    x: (clientX - stageRect.left - state.panX) / state.zoom,
    y: (clientY - stageRect.top - state.panY) / state.zoom,
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

function linksShareEndpoint(firstLink, secondLink) {
  return (
    firstLink.a === secondLink.a ||
    firstLink.a === secondLink.b ||
    firstLink.b === secondLink.a ||
    firstLink.b === secondLink.b
  );
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const firstOrientation = orientation(ax, ay, bx, by, cx, cy);
  const secondOrientation = orientation(ax, ay, bx, by, dx, dy);
  const thirdOrientation = orientation(cx, cy, dx, dy, ax, ay);
  const fourthOrientation = orientation(cx, cy, dx, dy, bx, by);

  return firstOrientation * secondOrientation < 0 && thirdOrientation * fourthOrientation < 0;
}

function orientation(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function nudgeBubble(bubble, velocityX, velocityY, draggedIds) {
  if (draggedIds.has(bubble.id) || bubble.isEditing) {
    return;
  }

  bubble.vx += velocityX;
  bubble.vy += velocityY;
}

function sceneStillMoving() {
  if (state.drag) {
    return true;
  }

  return state.bubbles.some((bubble) => {
    const speed = Math.abs(bubble.vx) + Math.abs(bubble.vy);
    return speed > 0.04;
  });
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

applyZoom();
