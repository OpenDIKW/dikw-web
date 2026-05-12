export type Locale = "en" | "zh-CN";
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const localeStorageKey = "dikw-web.locale";
export const themeStorageKey = "dikw-web.theme";

export const translations = {
  en: {
    brandSubtitle: "knowledge workbench",
    nav: {
      overview: "Overview",
      query: "Query",
      retrieve: "Retrieve",
      wiki: "Knowledge",
      graph: "Graph",
      wisdom: "Wisdom",
      tasks: "Tasks",
      settings: "Settings"
    },
    connection: {
      sameOrigin: "same-origin /v1 proxy",
      customServer: "custom server",
      tokenConfigured: "token configured",
      noToken: "no token"
    },
    settings: {
      eyebrow: "Settings",
      title: "Settings",
      description: "Manage connection, language, and appearance for this browser session.",
      connectionTitle: "Connection",
      connectionDetail: "Leave Server URL empty to use the same-origin /v1 proxy.",
      serverUrl: "Server URL",
      serverPlaceholder: "same-origin, or http://127.0.0.1:8765",
      token: "Token",
      tokenPlaceholder: "Bearer token",
      clearConnection: "Clear connection",
      appearanceTitle: "Appearance",
      appearanceDetail: "System follows your operating system preference.",
      system: "System",
      light: "Light",
      dark: "Dark",
      languageTitle: "Language",
      languageDetail: "Navigation and settings use the selected language.",
      english: "English",
      chinese: "简体中文",
      currentTheme: "Resolved theme"
    }
  },
  "zh-CN": {
    brandSubtitle: "知识工作台",
    nav: {
      overview: "概览",
      query: "查询",
      retrieve: "检索",
      wiki: "知识库",
      graph: "图谱",
      wisdom: "智慧",
      tasks: "任务",
      settings: "设置"
    },
    connection: {
      sameOrigin: "同源 /v1 代理",
      customServer: "自定义服务端",
      tokenConfigured: "已配置令牌",
      noToken: "未配置令牌"
    },
    settings: {
      eyebrow: "Settings",
      title: "设置",
      description: "管理当前浏览器会话的连接、语言和外观。",
      connectionTitle: "连接",
      connectionDetail: "Server URL 留空时使用同源 /v1 代理。",
      serverUrl: "服务器地址",
      serverPlaceholder: "同源代理，或 http://127.0.0.1:8765",
      token: "令牌",
      tokenPlaceholder: "Bearer token",
      clearConnection: "清空连接配置",
      appearanceTitle: "外观",
      appearanceDetail: "System 会跟随操作系统偏好。",
      system: "跟随系统",
      light: "浅色",
      dark: "深色",
      languageTitle: "语言",
      languageDetail: "导航和设置页会使用选择的语言。",
      english: "English",
      chinese: "简体中文",
      currentTheme: "当前主题"
    }
  }
} satisfies Record<Locale, unknown>;

export function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "zh-CN";
}

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}
