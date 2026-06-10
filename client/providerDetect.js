"use strict";
window.__providerDetectOK = false;
try {

// ====== Shared Provider Detection ======
// Used by both main process (via require) and renderer (via <script> tag).
// Attaches to `window` when in a browser context, exports via module when in Node.

function detectProvider(apiKey, modelDisplayName) {
  if (!apiKey || !apiKey.trim()) {
    if (modelDisplayName) {
      const m = modelDisplayName.toLowerCase();
      if (m.includes("deepseek")) return "DeepSeek";
      if (m.includes("claude") || m.includes("anthropic")) return "Anthropic";
      if (m.includes("gpt") || m.includes("openai")) return "OpenAI";
      if (m.includes("gemini")) return "Google";
      if (m.includes("qwen") || m.includes("tongyi")) return "Alibaba";
      if (m.includes("hunyuan")) return "Tencent";
      if (m.includes("glm") || m.includes("chatglm") || m.includes("zhipu")) return "Zhipu";
      if (m.includes("kimi") || m.includes("moonshot")) return "Moonshot";
      if (m.includes("doubao")) return "ByteDance";
      if (m.includes("ernie") || m.includes("wenxin")) return "Baidu";
      if (m.includes("spark")) return "iFlytek";
      if (m.includes("yi-") || m.includes("yi ")) return "Yi";
      if (m.includes("minimax")) return "MiniMax";
      if (m.includes("stepfun") || m.includes("step-")) return "StepFun";
      if (m.includes("skywork")) return "Skywork";
      if (m.includes("baichuan")) return "Baichuan";
      if (m.includes("grok")) return "xAI";
      if (m.includes("mistral")) return "Mistral";
      if (m.includes("llama")) return "Meta";
      if (m.includes("cohere")) return "Cohere";
    }
    return null;
  }
  const k = apiKey.trim();
  if (k.startsWith("sk-ant")) return "Anthropic";
  if (k.startsWith("sk-or-")) return "OpenRouter";
  if (k.startsWith("sk-")) {
    if (modelDisplayName) {
      const m = modelDisplayName.toLowerCase();
      if (m.includes("deepseek")) return "DeepSeek";
      if (m.includes("qwen") || m.includes("tongyi")) return "Alibaba";
      if (m.includes("hunyuan")) return "Tencent";
      if (m.includes("glm") || m.includes("zhipu")) return "Zhipu";
      if (m.includes("kimi") || m.includes("moonshot")) return "Moonshot";
      if (m.includes("doubao")) return "ByteDance";
      if (m.includes("ernie") || m.includes("wenxin")) return "Baidu";
      if (m.includes("minimax")) return "MiniMax";
      if (m.includes("yi-")) return "Yi";
      if (m.includes("grok")) return "xAI";
      if (m.includes("mistral")) return "Mistral";
      if (m.includes("cohere")) return "Cohere";
    }
    return "OpenAI";
  }
  if (k.startsWith("anthropic-")) return "Anthropic";
  if (k.startsWith("openai-")) return "OpenAI";
  if (k.startsWith("deepseek-")) return "DeepSeek";
  return "Custom";
}

function providerLabel(apiKey, modelDisplayName) {
  const p = detectProvider(apiKey, modelDisplayName);
  if (!p) return "";
  const labels = {
    Anthropic: "\u{1f539}", OpenAI: "\u{1f7e2}", OpenRouter: "\u{1f536}",
    DeepSeek: "\u{1f40b}", Alibaba: "\u{2601}\u{fe0f}", Tencent: "\u{1f4ac}",
    Zhipu: "\u{1f9e0}", Moonshot: "\u{1f319}", ByteDance: "\u{1f3b5}",
    Baidu: "\u{1f50d}", iFlytek: "\u{1f3a4}",
  };
  return labels[p] ? `${labels[p]} ${p}` : `\u{1f527} ${p}`;
}

// ====== Provider Logo Mapping ======
const VENDOR_LOGOS = {
  anthropic:        "assets/vendors/anthropic.png",
  claude:           "assets/vendors/anthropic.png",
  openai:           "assets/vendors/openai.png",
  chatgpt:          "assets/vendors/openai.png",
  gpt:              "assets/vendors/openai.png",
  google:           "assets/vendors/google.png",
  gemini:           "assets/vendors/google.png",
  meta:             "assets/vendors/meta.png",
  llama:            "assets/vendors/meta.png",
  mistral:          "assets/vendors/mistral.png",
  nvidia:           "assets/vendors/nvidia.png",
  microsoft:        "assets/vendors/openai.png",
  deepseek:         "assets/vendors/deepseek.png",
  qwen:             "assets/vendors/qwen.png",
  tongyi:           "assets/vendors/qwen.png",
  "tongyi-qianwen": "assets/vendors/qwen.png",
  baichuan:         "assets/vendors/baichuan.png",
  hunyuan:          "assets/vendors/hunyuan.png",
  spark:            "assets/vendors/spark.png",
  "spark-desk":     "assets/vendors/spark.png",
  wenxin:           "assets/vendors/wenxin.png",
  "ernie-bot":      "assets/vendors/wenxin.png",
  yi:               "assets/vendors/yi.png",
  "yi-lightning":   "assets/vendors/yi.png",
  stepfun:          "assets/vendors/stepfun.png",
  step:             "assets/vendors/stepfun.png",
  skywork:          "assets/vendors/skywork.png",
  kimi:             "assets/vendors/kimi.png",
  moonshot:         "assets/vendors/kimi.png",
  doubao:           "assets/vendors/doubao.png",
  zhipu:            "assets/vendors/zhipu.png",
  glm:              "assets/vendors/zhipu.png",
  chatglm:          "assets/vendors/zhipu.png",
  minimax:          "assets/vendors/minimax.png",
  internlm:         "assets/vendors/internlm.png",
  codegeex:         "assets/vendors/codegeex.png",
  yuanbao:          "assets/vendors/yuanbao.png",
  "hunyuan-t1":     "assets/vendors/yuanbao.png",
  siliconcloud:     "assets/vendors/siliconcloud.png",
  siliconflow:      "assets/vendors/siliconcloud.png",
  alibaba:          "assets/vendors/alibaba.png",
  baidu:            "assets/vendors/baidu.png",
  tencent:          "assets/vendors/tencent.png",
  bytedance:        "assets/vendors/bytedance.png",
  iflytek:          "assets/vendors/iflytekcloud.png",
  iflytekcloud:     "assets/vendors/iflytekcloud.png",
  cohere:           "assets/vendors/cohere.png",
  grok:             "assets/vendors/grok.png",
  xai:              "assets/vendors/xai.png",
  perplexity:       "assets/vendors/perplexity.png",
  groq:             "assets/vendors/groq.png",
  together:         "assets/vendors/together.png",
  "together-ai":    "assets/vendors/together.png",
  huggingface:      "assets/vendors/huggingface.png",
  ollama:           "assets/vendors/ollama.png",
  replicate:        "assets/vendors/replicate.png",
  cerebras:         "assets/vendors/cerebras.png",
  fireworks:        "assets/vendors/fireworks.png",
  sambanova:        "assets/vendors/sambanova.png",
  novita:           "assets/vendors/novita.png",
  openrouter:       "assets/vendors/openrouter.png",
  openclaw:         "assets/vendors/openclaw.png",
  phind:            "assets/vendors/phind.png",
};

const VENDOR_LOGOS_ENTRIES = Object.entries(VENDOR_LOGOS)
  .sort(([a], [b]) => b.length - a.length);

const RUNTIME_LOGO = {
  hermes:   "assets/vendors/anthropic.png",
  codex:    "assets/vendors/openai.png",
  openclaw: "assets/vendors/openclaw.png",
};

function runtimeDisplayName(runtime) {
  if (runtime === "openclaw") return "OpenClaw";
  if (runtime === "hermes") return "Hermes";
  if (runtime === "codex") return "Codex";
  return runtime || "";
}

function providerLogo(player) {
  // 1. Check model_display_name for known keywords (longest match first)
  const model = (player.model_display_name || "").toLowerCase();
  for (const [keyword, logo] of VENDOR_LOGOS_ENTRIES) {
    if (model.includes(keyword)) return logo;
  }
  // 2. Check api_provider field
  const provider = (player.api_provider || "").toLowerCase();
  for (const [keyword, logo] of VENDOR_LOGOS_ENTRIES) {
    if (provider.includes(keyword)) return logo;
  }
  // 3. Check agent_runtime mapping (fallback)
  const runtime = (player.agent_runtime || "").toLowerCase();
  if (RUNTIME_LOGO[runtime]) return RUNTIME_LOGO[runtime];
  return null;
}

// Dual-environment export
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    detectProvider,
    providerLabel,
    VENDOR_LOGOS,
    VENDOR_LOGOS_ENTRIES,
    RUNTIME_LOGO,
    providerLogo,
    runtimeDisplayName,
  };
} else if (typeof window !== "undefined") {
  window.AIAWD_PROVIDER = {
    detectProvider,
    providerLabel,
    VENDOR_LOGOS,
    VENDOR_LOGOS_ENTRIES,
    RUNTIME_LOGO,
    providerLogo,
    runtimeDisplayName,
  };
}
window.__providerDetectOK = true;
} catch (e) {
  document.body.innerHTML = '<div style="color:#ef4444;padding:40px;font-family:monospace;background:#0f172a;height:100vh"><h2>ProviderDetect 初始化失败</h2><pre style="white-space:pre-wrap;word-break:break-all">'+e.message+'\n'+e.stack+'</pre></div>';
}
