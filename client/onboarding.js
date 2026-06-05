// AI-AWD Arena 新手教程 / Onboarding Tutorial
// —————————————————————————————————————————————
// State machine that walks a first-time user through the full AWD match flow.
// Persists completion in localStorage so the tutorial only auto-starts once.
//
// Architecture:
//   OnboardingStore  – localStorage-backed persistence
//   OnboardingSteps  – step definitions (target element, position, copy)
//   OnboardingEngine – state machine: idle → active(done) → finished
//   renderOnboarding – DOM side-effects (spotlight, tooltip, overlay)
//
// Integration:
//   renderer.js calls OnboardingEngine.init() after DOMContentLoaded.
//   The engine owns its DOM and reacts to user clicks on nav buttons.
//   It never mutates renderer state directly.

const ONBOARDING_STORAGE_KEY = "aiawd_onboarding_v1";

const OnboardingStore = {
  get() {
    try {
      const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  markCompleted() {
    try {
      localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        JSON.stringify({ completed: true, completedAt: Date.now() }),
      );
    } catch {
      // storage unavailable – silently skip
    }
  },
  markDismissed() {
    try {
      localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        JSON.stringify({ completed: false, dismissed: true, dismissedAt: Date.now() }),
      );
    } catch {
      // storage unavailable
    }
  },
  reset() {
    try {
      localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    } catch {
      // storage unavailable
    }
  },
  isCompleted() {
    const record = this.get();
    return !!(record && record.completed);
  },
  isDismissed() {
    const record = this.get();
    return !!(record && record.dismissed);
  },
};

const ONBOARDING_STEPS = [
  {
    id: "welcome",
    title: "欢迎来到 AI-AWD Arena",
    body: "AI 攻防大乱斗竞技场 — 每个玩家维护自己的靶机防线，同时攻陷对手靶机获取 Flag 得分。下面用 2 分钟带你快速上手。",
    target: null,
    position: "center",
  },
  {
    id: "connect",
    title: "第一步：连接裁判服务器",
    body: "输入裁判服务器地址和端口（本地默认 127.0.0.1:9000），填写你的显示名称，点击「连接」按钮。连接成功后左侧状态徽章会变绿。",
    target: "#connect",
    position: "right",
  },
  {
    id: "create-room",
    title: "第二步：创建 AI 攻防房间",
    body: "房主在此填写房间名、选择靶机模板、设定准备/加固/攻防各阶段时长，点击「创建」生成房间。房间会出现在右侧公开房间列表。",
    target: "#createRoom",
    position: "right",
  },
  {
    id: "room-list",
    title: "从公开房间加入",
    body: "不想当房主？从右侧公开房间列表点击任意房间，房间 ID 会自动填入左侧输入框。也可以手动输入房间 ID 参赛。",
    target: "#roomList",
    position: "left",
  },
  {
    id: "join-ready",
    title: "第三步：参赛入场与准备",
    body: "填入房间 ID，选择 Agent 运行时和模型名称，点击「参赛」加入。加入后依次点击「靶机就绪」和「Agent 就绪」告知裁判你已准备完毕。",
    target: "#joinPlayer",
    position: "right",
  },
  {
    id: "start-match",
    title: "第四步：开始比赛",
    body: "所有玩家靶机和 Agent 就绪后，房主点击「开始比赛」。裁判会按准备→加固→攻防→结束的顺序自动推进阶段。",
    target: "#startMatch",
    position: "right",
  },
  {
    id: "arena",
    title: "AI 攻防大乱斗战场",
    body: "战场地图展示所有 Agent 玩家状态：绿色边框 = 我方、金色边框 = 领先、红色 = 已失守。连线动画展示攻陷路线。点击玩家头像可聚焦查看详情，底部的回放控制可逐帧回看每一次攻陷。",
    target: "#arenaMap",
    position: "top",
  },
  {
    id: "submit-flag",
    title: "第五步：提交攻陷凭证",
    body: "攻防阶段中，Agent 自动攻击对手靶机获取 Flag，或通过你的战斗包中的命令手动获取。拿到 Flag 后在此粘贴提交，裁判验证通过后即可得分。",
    target: "#submitFlag",
    position: "right",
  },
  {
    id: "results",
    title: "比赛结算与战报",
    body: "比赛结束后查看冠军、前三名排行榜和攻陷回放。点击「生成战报」可生成 Markdown 格式的完整战报，支持复制和下载。所有私有 Flag 在战报中自动隐藏。",
    target: "#resultSummary",
    position: "top",
  },
  {
    id: "done",
    title: "准备就绪！",
    body: "你已经了解了 AI-AWD Arena 的完整流程。关闭教程，去创建你的第一场 AI 攻防大乱斗吧！随时可以点击顶部「新手教程」按钮重新查看。",
    target: null,
    position: "center",
  },
];

const OnboardingEngine = {
  _active: false,
  _stepIndex: 0,
  _els: {},
  _overlayEl: null,
  _spotlightEl: null,
  _tooltipEl: null,
  _progressEl: null,

  // —— public API ——

  init() {
    this._cacheDom();
    if (this._overlayEl) {
      this._bindOverlayClicks();
    }
    this._bindGlobalKeyboard();
    return this;
  },

  /** True when the tutorial overlay is visible. */
  get active() {
    return this._active;
  },

  /** Whether the user has ever completed the tutorial. */
  isCompleted() {
    return OnboardingStore.isCompleted();
  },

  /** Auto-start if this looks like a first run. */
  autoStart() {
    if (OnboardingStore.isCompleted() || OnboardingStore.isDismissed()) {
      return false;
    }
    this.start();
    return true;
  },

  /** Start (or restart) the tutorial from step 0. */
  start() {
    this._active = true;
    this._stepIndex = 0;
    this._render();
  },

  /** Dismiss the tutorial without marking completed. */
  dismiss() {
    OnboardingStore.markDismissed();
    this._teardown();
  },

  /** Jump to a specific step by id. */
  goTo(stepId) {
    const index = ONBOARDING_STEPS.findIndex((s) => s.id === stepId);
    if (index >= 0) {
      this._stepIndex = index;
      if (this._active) this._render();
    }
  },

  /** Step forward. */
  next() {
    if (this._stepIndex < ONBOARDING_STEPS.length - 1) {
      this._stepIndex += 1;
      this._render();
    } else {
      this._finish();
    }
  },

  /** Step backward. */
  prev() {
    if (this._stepIndex > 0) {
      this._stepIndex -= 1;
      this._render();
    }
  },

  /** Force-close (used when DOM is torn down). */
  destroy() {
    this._teardown();
  },

  // —— internal ——

  _cacheDom() {
    this._overlayEl = document.getElementById("onboardingOverlay");
    this._spotlightEl = document.getElementById("onboardingSpotlight");
    this._tooltipEl = document.getElementById("onboardingTooltip");
    this._progressEl = document.getElementById("onboardingProgress");
  },

  _bindOverlayClicks() {
    if (!this._overlayEl) return;
    this._overlayEl.addEventListener("click", (e) => {
      // Only close if clicking the dark backdrop (not the tooltip)
      if (e.target === this._overlayEl || e.target.classList.contains("onboarding-backdrop")) {
        // don't close on backdrop click during welcome/done
        const step = ONBOARDING_STEPS[this._stepIndex];
        if (step && step.position === "center") return;
        this.dismiss();
      }
    });
  },

  _bindGlobalKeyboard() {
    this._keyHandler = (e) => {
      if (!this._active) return;
      if (e.key === "Escape") {
        this.dismiss();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        this.next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        this.prev();
      }
    };
    document.addEventListener("keydown", this._keyHandler);
  },

  _teardown() {
    this._active = false;
    if (this._overlayEl) this._overlayEl.style.display = "none";
    this._clearSpotlight();
  },

  _finish() {
    OnboardingStore.markCompleted();
    this._teardown();
  },

  _render() {
    if (!this._overlayEl) return;
    const step = ONBOARDING_STEPS[this._stepIndex];
    if (!step) return;

    this._overlayEl.style.display = "block";

    if (step.position === "center") {
      this._renderCenter(step);
    } else {
      this._renderSpotlight(step);
    }

    this._renderTooltip(step);
    this._renderProgress();
  },

  _renderCenter(step) {
    // Full-screen welcome or done screen — no spotlight, centered tooltip
    this._clearSpotlight();
    this._overlayEl.className = "onboarding-overlay is-center";
  },

  _renderSpotlight(step) {
    const target = step.target ? document.querySelector(step.target) : null;
    this._overlayEl.className = "onboarding-overlay is-spotlight";

    if (target) {
      const rect = target.getBoundingClientRect();
      const pad = 8;
      this._spotlightEl.style.display = "block";
      this._spotlightEl.style.top = `${rect.top - pad}px`;
      this._spotlightEl.style.left = `${rect.left - pad}px`;
      this._spotlightEl.style.width = `${rect.width + pad * 2}px`;
      this._spotlightEl.style.height = `${rect.height + pad * 2}px`;

      // Scroll target into view if needed
      if (rect.top < 60 || rect.bottom > window.innerHeight - 60) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        // Re-measure after scroll (approximate — will refine on next frame)
        requestAnimationFrame(() => {
          const r2 = target.getBoundingClientRect();
          this._spotlightEl.style.top = `${r2.top - pad}px`;
          this._spotlightEl.style.left = `${r2.left - pad}px`;
          this._spotlightEl.style.width = `${r2.width + pad * 2}px`;
          this._spotlightEl.style.height = `${r2.height + pad * 2}px`;
        });
      }
    } else {
      this._spotlightEl.style.display = "none";
    }
  },

  _clearSpotlight() {
    if (this._spotlightEl) {
      this._spotlightEl.style.display = "none";
    }
  },

  _renderTooltip(step) {
    if (!this._tooltipEl) return;

    const isFirst = this._stepIndex === 0;
    const isLast = this._stepIndex === ONBOARDING_STEPS.length - 1;
    const total = ONBOARDING_STEPS.length;

    this._tooltipEl.className = `onboarding-tooltip onboarding-pos-${step.position}`;
    this._tooltipEl.innerHTML = `
      <div class="onboarding-tooltip-header">
        <span class="onboarding-step-badge">${this._stepIndex + 1} / ${total}</span>
        <h3>${escapeHtml(step.title)}</h3>
      </div>
      <p>${step.body}</p>
      <div class="onboarding-tooltip-actions">
        <button class="onboarding-btn onboarding-btn-skip" data-onboarding-action="dismiss">
          ${isLast ? "完成" : "跳过教程"}
        </button>
        <div class="onboarding-nav-group">
          <button class="onboarding-btn" data-onboarding-action="prev"${isFirst ? " disabled" : ""}>
            ← 上一步
          </button>
          <button class="onboarding-btn onboarding-btn-primary" data-onboarding-action="next">
            ${isLast ? "✓ 完成" : "下一步 →"}
          </button>
        </div>
      </div>
    `;

    // Position the tooltip relative to the spotlight or center it
    if (step.position === "center") {
      this._tooltipEl.style.top = "50%";
      this._tooltipEl.style.left = "50%";
      this._tooltipEl.style.transform = "translate(-50%, -50%)";
      this._tooltipEl.style.right = "auto";
      this._tooltipEl.style.bottom = "auto";
    } else if (this._spotlightEl.style.display !== "none") {
      const spotTop = parseFloat(this._spotlightEl.style.top) || 0;
      const spotLeft = parseFloat(this._spotlightEl.style.left) || 0;
      const spotWidth = parseFloat(this._spotlightEl.style.width) || 0;
      const spotHeight = parseFloat(this._spotlightEl.style.height) || 0;
      const gap = 16;

      this._tooltipEl.style.transform = "none";

      switch (step.position) {
        case "right":
          this._tooltipEl.style.top = `${spotTop}px`;
          this._tooltipEl.style.left = `${spotLeft + spotWidth + gap}px`;
          this._tooltipEl.style.right = "auto";
          this._tooltipEl.style.bottom = "auto";
          this._tooltipEl.style.maxWidth = `${Math.min(380, window.innerWidth - spotLeft - spotWidth - gap - 24)}px`;
          break;
        case "left":
          this._tooltipEl.style.top = `${spotTop}px`;
          this._tooltipEl.style.right = `${window.innerWidth - spotLeft + gap}px`;
          this._tooltipEl.style.left = "auto";
          this._tooltipEl.style.bottom = "auto";
          this._tooltipEl.style.maxWidth = `${Math.min(380, spotLeft - gap - 24)}px`;
          break;
        case "top":
          this._tooltipEl.style.bottom = `${window.innerHeight - spotTop + gap}px`;
          this._tooltipEl.style.left = `${spotLeft}px`;
          this._tooltipEl.style.top = "auto";
          this._tooltipEl.style.right = "auto";
          this._tooltipEl.style.maxWidth = `${Math.min(420, window.innerWidth - spotLeft - 24)}px`;
          break;
        case "bottom":
          this._tooltipEl.style.top = `${spotTop + spotHeight + gap}px`;
          this._tooltipEl.style.left = `${spotLeft}px`;
          this._tooltipEl.style.right = "auto";
          this._tooltipEl.style.bottom = "auto";
          this._tooltipEl.style.maxWidth = `${Math.min(420, window.innerWidth - spotLeft - 24)}px`;
          break;
        default:
          break;
      }
    }

    // Bind action buttons
    for (const btn of this._tooltipEl.querySelectorAll("[data-onboarding-action]")) {
      btn.addEventListener("click", (e) => {
        const action = e.currentTarget.dataset.onboardingAction;
        if (action === "next") this.next();
        else if (action === "prev") this.prev();
        else if (action === "dismiss") {
          if (isLast) this._finish();
          else this.dismiss();
        }
      });
    }
  },

  _renderProgress() {
    if (!this._progressEl) return;
    const total = ONBOARDING_STEPS.length;
    this._progressEl.innerHTML = ONBOARDING_STEPS.map((_, i) => {
      let cls = "onboarding-dot";
      if (i === this._stepIndex) cls += " is-active";
      else if (i < this._stepIndex) cls += " is-done";
      return `<span class="${cls}" data-onboarding-go-to="${i}"></span>`;
    }).join("");

    for (const dot of this._progressEl.querySelectorAll("[data-onboarding-go-to]")) {
      dot.addEventListener("click", (e) => {
        const index = parseInt(e.currentTarget.dataset.onboardingGoTo, 10);
        if (!isNaN(index) && index >= 0 && index < ONBOARDING_STEPS.length) {
          this._stepIndex = index;
          this._render();
        }
      });
    }
  },
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Expose for tests and renderer integration
if (typeof module !== "undefined" && module.exports) {
  module.exports = { OnboardingEngine, OnboardingStore, ONBOARDING_STEPS };
}
// Browser global (script tag)
if (typeof window !== "undefined") {
  window.OnboardingEngine = OnboardingEngine;
  window.OnboardingStore = OnboardingStore;
  window.ONBOARDING_STEPS = ONBOARDING_STEPS;
}
