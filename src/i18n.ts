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
      chat: "Chat",
      retrieve: "Retrieve",
      wiki: "Knowledge",
      graph: "Graph",
      wisdom: "Wisdom",
      tasks: "Tasks",
      settings: "Settings"
    },
    navGroups: {
      knowledge: "Knowledge",
      system: "System"
    },
    pages: {
      overview: {
        title: "Overview",
        refresh: "Refresh overview",
        errorTitle: "Could not read dikw-core status"
      },
      chat: {
        title: "Chat",
        sessionsTitle: "Chat history",
        newSession: "New chat",
        deleteSession: "Delete chat",
        renameSession: "Rename chat",
        titleLabel: "Chat title",
        saveTitle: "Save title",
        cancelRename: "Cancel rename",
        emptyTitleError: "Chat title is required",
        loadingSessions: "Loading chats",
        emptySession: "No messages yet",
        chatRegion: "Chat conversation",
        messageLabel: "Message",
        messagePlaceholder: "Ask the DIKW agent about the knowledge base",
        send: "Send",
        stop: "Stop",
        errorTitle: "Agent failed",
        emptyAnswerTitle: "Start a chat",
        emptyAnswerDetail: "The agent will retrieve core knowledge, inspect pages, and compose an answer with sources.",
        userRole: "User",
        assistantRole: "Agent",
        contextTitle: "Context for this reply",
        sourcesTitle: "Sources",
        emptySources: "No sources for this reply",
        toolsTitle: "Tool calls",
        emptyTools: "No tool calls for this reply",
        toolStatusRunning: "Running",
        toolStatusSucceeded: "Succeeded",
        toolStatusFailed: "Failed"
      },
      retrieve: {
        title: "Retrieve",
        queryLabel: "Query",
        queryPlaceholder: "Search chunks and page refs",
        limitLabel: "Limit",
        run: "Run",
        stop: "Stop",
        errorTitle: "Retrieve failed",
        chunksTitle: "Chunks",
        emptyChunks: "No chunks yet",
        emptyChunksDetail: "Run retrieve to show final chunks; streaming partial results appear as a preview.",
        pageRefsTitle: "Page Refs",
        emptyPageRefs: "No page refs"
      },
      wiki: {
        title: "Knowledge",
        refresh: "Refresh knowledge",
        listErrorTitle: "Could not read wiki pages",
        pageErrorTitle: "Could not read page",
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
        previewErrorTitle: "Could not read linked page",
        noMatches: "No matching pages"
      },
      graph: {
        title: "Graph",
        refresh: "Refresh graph",
        searchPlaceholder: "Search graph...",
        hideOrphans: "Hide orphans",
        resetFocus: "Reset focus",
        openInWiki: "Open in Knowledge",
        readingPages: "Reading",
        pages: "pages",
        emptyGraph: "No graph nodes to display",
        partialReadWarning: "Some page bodies could not be read. The graph continues with returned pages.",
        errorTitle: "Could not build graph"
      },
      wisdom: {
        title: "Wisdom",
        refresh: "Refresh wisdom items",
        statusLabel: "Status",
        kindLabel: "Kind",
        errorTitle: "Could not read wisdom items",
        emptyList: "No wisdom items",
        loadingList: "Reading wisdom items",
        selectItem: "Select a wisdom item"
      },
      tasks: {
        title: "Tasks",
        refresh: "Refresh tasks",
        statusLabel: "Status",
        opLabel: "Op",
        listErrorTitle: "Could not read task list",
        eventsErrorTitle: "Could not read task events",
        taskListEmpty: "No task records",
        selectTask: "Select a task",
        waitingEvents: "Waiting for events",
        eventsNotLoaded: "Events not loaded",
        terminalEventDetail: "Click Load events to view the task event timeline.",
        runningEventDetail: "Click Follow to stream task events.",
        waitingForCount: "Waiting for count",
        totalUnknown: "total unknown",
        scanned: "Scanned",
        processed: "Processed"
      }
    },
    connection: {
      tokenConfigured: "token configured",
      noToken: "no token"
    },
    settings: {
      title: "Settings",
      description: "Manage connection, language, and appearance for this browser session.",
      connectionTitle: "Connection",
      connectionDetail: "Configure the dikw-core API address used by the web app and Agent.",
      serverUrl: "Server URL",
      serverPlaceholder: "http://127.0.0.1:8765",
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
      chat: "会话",
      retrieve: "检索",
      wiki: "知识库",
      graph: "图谱",
      wisdom: "智慧",
      tasks: "任务",
      settings: "设置"
    },
    navGroups: {
      knowledge: "知识",
      system: "系统"
    },
    pages: {
      overview: {
        title: "工作台概览",
        refresh: "刷新概览",
        errorTitle: "无法读取 dikw-core 状态"
      },
      chat: {
        title: "会话",
        sessionsTitle: "会话历史",
        newSession: "新建会话",
        deleteSession: "删除会话",
        renameSession: "重命名会话",
        titleLabel: "会话标题",
        saveTitle: "保存标题",
        cancelRename: "取消重命名",
        emptyTitleError: "会话标题不能为空",
        loadingSessions: "加载会话中",
        emptySession: "暂无消息",
        chatRegion: "会话内容",
        messageLabel: "消息",
        messagePlaceholder: "向 DIKW Agent 询问知识库内容",
        send: "发送",
        stop: "停止",
        errorTitle: "Agent 失败",
        emptyAnswerTitle: "开始会话",
        emptyAnswerDetail: "Agent 会检索 core 知识、读取页面，并带来源生成回答。",
        userRole: "用户",
        assistantRole: "Agent",
        contextTitle: "本轮回复上下文",
        sourcesTitle: "来源",
        emptySources: "本轮回复暂无来源",
        toolsTitle: "工具调用",
        emptyTools: "本轮回复暂无工具调用",
        toolStatusRunning: "运行中",
        toolStatusSucceeded: "已完成",
        toolStatusFailed: "失败"
      },
      retrieve: {
        title: "检索上下文",
        queryLabel: "检索",
        queryPlaceholder: "检索 chunk 和 page refs",
        limitLabel: "数量",
        run: "运行",
        stop: "停止",
        errorTitle: "检索失败",
        chunksTitle: "Chunks",
        emptyChunks: "尚无 chunks",
        emptyChunksDetail: "运行检索后会显示最终 chunks；流式 partial 会先作为预览出现。",
        pageRefsTitle: "Page Refs",
        emptyPageRefs: "尚无 page refs"
      },
      wiki: {
        title: "知识库",
        refresh: "刷新知识库",
        listErrorTitle: "无法读取 wiki pages",
        pageErrorTitle: "无法读取页面",
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
        previewErrorTitle: "无法读取引用页面",
        noMatches: "没有匹配页面"
      },
      graph: {
        title: "知识图谱",
        refresh: "刷新图谱",
        searchPlaceholder: "搜索图谱...",
        hideOrphans: "隐藏孤立节点",
        resetFocus: "重置聚焦",
        openInWiki: "在知识库打开",
        readingPages: "读取",
        pages: "pages",
        emptyGraph: "没有可显示的图谱节点",
        partialReadWarning: "部分页面正文读取失败，图谱已用已返回页面继续构建。",
        errorTitle: "无法构建知识图谱"
      },
      wisdom: {
        title: "智慧沉淀",
        refresh: "刷新智慧条目",
        statusLabel: "状态",
        kindLabel: "类型",
        errorTitle: "无法读取智慧条目",
        emptyList: "暂无智慧条目",
        loadingList: "读取智慧条目中",
        selectItem: "选择一个智慧条目"
      },
      tasks: {
        title: "任务",
        refresh: "刷新任务",
        statusLabel: "状态",
        opLabel: "操作",
        listErrorTitle: "无法读取任务列表",
        eventsErrorTitle: "无法读取任务事件",
        taskListEmpty: "没有任务记录",
        selectTask: "选择一个任务",
        waitingEvents: "等待事件",
        eventsNotLoaded: "事件尚未加载",
        terminalEventDetail: "点击 Load events 查看任务事件时间线。",
        runningEventDetail: "点击 Follow 跟随任务事件流。",
        waitingForCount: "等待统计",
        totalUnknown: "总量未知",
        scanned: "已扫描",
        processed: "已处理"
      }
    },
    connection: {
      tokenConfigured: "已配置令牌",
      noToken: "未配置令牌"
    },
    settings: {
      title: "设置",
      description: "管理当前浏览器会话的连接、语言和外观。",
      connectionTitle: "连接",
      connectionDetail: "配置 Web 与 Agent 使用的 dikw-core API 地址。",
      serverUrl: "服务器地址",
      serverPlaceholder: "http://127.0.0.1:8765",
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
