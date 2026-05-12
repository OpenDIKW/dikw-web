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
    pages: {
      overview: {
        eyebrow: "Workbench",
        title: "Overview",
        refresh: "Refresh overview"
      },
      query: {
        eyebrow: "Query",
        title: "Query"
      },
      retrieve: {
        eyebrow: "Retrieve",
        title: "Retrieve"
      },
      wiki: {
        eyebrow: "知识",
        title: "Knowledge",
        refresh: "Refresh knowledge",
        baseEyebrow: "Base",
        directoryTitle: "Directory",
        searchPlaceholder: "Search files...",
        clearSearch: "Clear directory search",
        emptyReader: "Select a document to start reading",
        loadingPage: "Reading page",
        readTab: "Read",
        infoTab: "Info",
        outlineTab: "Outline",
        sourceTab: "Source",
        tabList: "Wiki reader views",
        infoPanel: "Info",
        outlinePanel: "Outline",
        noHeadings: "No headings",
        noWikilinks: "No wikilinks",
        previewRegion: "Wiki link preview",
        previewTitle: "Link preview",
        previewLoading: "Reading linked page",
        previewClose: "Collapse link preview",
        previewOpen: "Open as main document",
        previewNotFound: "Linked page not found",
        previewFilter: "Filter directory by target",
        noMatches: "No matching pages"
      },
      graph: {
        eyebrow: "Network",
        title: "Graph",
        refresh: "Refresh graph",
        searchPlaceholder: "Search graph...",
        hideOrphans: "Hide orphans",
        resetFocus: "Reset focus",
        openInWiki: "Open in Knowledge"
      },
      wisdom: {
        eyebrow: "Wisdom Layer",
        title: "Wisdom",
        refresh: "Refresh wisdom items"
      },
      tasks: {
        eyebrow: "Runs",
        title: "Tasks",
        refresh: "Refresh tasks"
      }
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
    pages: {
      overview: {
        eyebrow: "工作台",
        title: "工作台概览",
        refresh: "刷新概览"
      },
      query: {
        eyebrow: "查询",
        title: "自然语言查阅"
      },
      retrieve: {
        eyebrow: "检索",
        title: "检索上下文"
      },
      wiki: {
        eyebrow: "Wiki",
        title: "知识库",
        refresh: "刷新知识库",
        baseEyebrow: "Base",
        directoryTitle: "目录",
        searchPlaceholder: "搜索文件...",
        clearSearch: "清空目录搜索",
        emptyReader: "选择一篇文档开始阅读",
        loadingPage: "读取页面中",
        readTab: "阅读",
        infoTab: "信息",
        outlineTab: "目录与链接",
        sourceTab: "源码",
        tabList: "Wiki 阅读视图",
        infoPanel: "信息",
        outlinePanel: "目录与链接",
        noHeadings: "没有目录",
        noWikilinks: "没有 wikilink",
        previewRegion: "链接预览",
        previewTitle: "链接预览",
        previewLoading: "读取引用页面中",
        previewClose: "收起链接预览",
        previewOpen: "打开为主文档",
        previewNotFound: "未找到引用页面",
        previewFilter: "用目标过滤目录",
        noMatches: "没有匹配页面"
      },
      graph: {
        eyebrow: "图谱",
        title: "知识图谱",
        refresh: "刷新图谱",
        searchPlaceholder: "搜索图谱...",
        hideOrphans: "隐藏孤立节点",
        resetFocus: "重置聚焦",
        openInWiki: "在知识库打开"
      },
      wisdom: {
        eyebrow: "智慧",
        title: "智慧沉淀",
        refresh: "刷新智慧条目"
      },
      tasks: {
        eyebrow: "任务",
        title: "任务",
        refresh: "刷新任务"
      }
    },
    connection: {
      sameOrigin: "同源 /v1 代理",
      customServer: "自定义服务端",
      tokenConfigured: "已配置令牌",
      noToken: "未配置令牌"
    },
    settings: {
      eyebrow: "偏好",
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
