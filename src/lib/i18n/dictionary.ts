export type Locale = "en" | "ur";

/**
 * Visible UI text only. Database content (property titles, names, emails,
 * dates, money values) is left untouched.
 */
export const DICT = {
  en: {
    locale: { switchTo: "اردو", label: "Switch language" },

    nav: {
      dashboard: "Dashboard",
      properties: "Properties",
      map: "Map",
      leads: "Leads",
      deals: "Deals",
      calendar: "Calendar",
      visits: "Visits",
      commissions: "Commissions",
      payments: "Payments",
      agents: "Agents",
      dealers: "Dealers",
      documents: "Documents",
      reports: "Reports",
      activityLog: "Activity log",
      notifications: "Notifications",
      settings: "Settings",
      companies: "Companies",
    },

    groups: {
      workspace: "Workspace",
      sales: "Sales",
      field: "Field",
      finance: "Finance",
      people: "People",
      insights: "Insights",
      system: "System",
    },

    shell: {
      collapse: "Collapse",
      signOut: "Sign out",
      searchPlaceholder: "Search properties, leads, deals…",
      searchInner: "Search properties, leads, deals, clients…",
      searchFor: "Search for",
      recent: "Recent",
      jumpTo: "Jump to",
      notifications: "Notifications",
    },

    common: {
      viewAll: "View all",
      allLeads: "All leads",
      reports: "Reports",
      calendar: "Calendar",
      fullCalendar: "Full calendar",
      review: "Review",
      noActivity: "No activity recorded yet.",
      noResults: "No results.",
      total: "Total",
      peak: "Peak",
      available: "available",
    },

    login: {
      tagline: "Real Estate CRM / ERP",
      heroTitle: "One home for properties, people, deals & money.",
      heroSubtitle:
        "Run listings, leads, agents, dealers, commissions, payments and reporting — built for the office and the field.",
      welcomeBack: "Welcome back",
      subtitle: "Sign in to your workspace to continue.",
      email: "Email",
      password: "Password",
      show: "Show",
      hide: "Hide",
      signIn: "Sign in",
      signingIn: "Signing in…",
      demoAccounts: "Demo accounts",
      feat: {
        dashboards: "Role-aware dashboards",
        field: "Field check-ins & visits",
        commission: "Flexible commission engine",
        docs: "Documents & reports",
      },
      copyright: "Real Estate CRM & ERP",
    },

    dashboard: {
      owner: {
        eyebrow: "Owner dashboard",
        title: "How the business is doing",
        subtitle: "Revenue, commissions, pipeline and the people driving it — in one view.",
      },
      admin: {
        eyebrow: "Admin dashboard",
        title: "What needs attention today",
        subtitle: "Operations at a glance — assignments, verifications and approvals.",
      },
      dealer: { eyebrow: "Dealer dashboard" },
      agent: {
        morning: "Good morning",
        afternoon: "Good afternoon",
        evening: "Good evening",
        heroLead: "— let's make today count.",
        heroSub: "Today's schedule, your leads and your earnings.",
      },
      deltaFlat: "Flat vs last month",
      deltaUp: "vs last month",
      deltaDown: "vs last month",
      allTimeRevenue: "All-time revenue:",
      revenueTotalLabel: "month sales total",
    },

    stats: {
      revenueThisMonth: "Revenue this month",
      commissionPending: "Commission pending",
      openDeals: "Open deals",
      overduePayments: "Overdue payments",
      inPipeline: "In the pipeline",
      outstanding: "outstanding",
      paid: "paid",
      leadsToAssign: "Leads to assign",
      visitsToVerify: "Visits to verify",
      docsToCheck: "Docs to check",
      paymentsDue: "Payments due",
      pendingOverdue: "pending + overdue",
      todaysTasks: "Today's tasks",
      activeLeads: "Active leads",
      properties: "Properties",
      inventory: "Inventory",
      dealsClosed: "Deals closed",
      shareEarned: "Share earned",
      sharePending: "Share pending",
      earned: "earned",
    },

    sections: {
      revenueTrend: "Revenue trend · last 6 months",
      inventoryMix: "Inventory mix",
      leadPipeline: "Lead pipeline",
      agentLeaderboard: "Agent leaderboard",
      todaysSchedule: "Today's schedule",
      todaysCalendar: "Today's calendar",
      yourActiveLeads: "Your active leads",
      commissionsAwaitingApproval: "Commissions awaiting approval",
      yourInventory: "Your inventory",
      dealsThroughInventory: "Deals through your inventory",
    },

    empty: {
      noAgents: "No agents yet.",
      noProperties: "No properties yet.",
      noAppointmentsToday: "No appointments today. Time to chase some leads!",
      noActiveLeads: "No active leads assigned.",
      nothingScheduled: "Nothing scheduled today.",
      nothingPending: "Nothing pending approval.",
      noLinkedProperties: "No properties linked to your profile.",
      noClosedDeals: "No closed deals yet.",
      noDealerProfile: "No dealer profile is linked to your account yet. Ask an admin to set it up.",
    },

    units: {
      won: "won",
      conversion: "conversion",
      leads: "leads",
    },

    status: {
      AVAILABLE: "Available",
      RESERVED: "Reserved",
      UNDER_NEGOTIATION: "Under Negotiation",
      RENTED: "Rented",
      SOLD: "Sold",
      INACTIVE: "Inactive",
      PENDING_VERIFICATION: "Pending Verification",

      NEW: "New",
      CONTACTED: "Contacted",
      INTERESTED: "Interested",
      SITE_VISIT: "Site Visit",
      PROPERTY_SHOWN: "Property Shown",
      NEGOTIATION: "Negotiation",
      TOKEN_BOOKING: "Token Booking",
      PAYMENT: "Payment",
      CLOSED_WON: "Closed Won",
      CLOSED_LOST: "Closed Lost",

      DRAFT: "Draft",
      TOKEN: "Token",
      BOOKED: "Booked",
      AGREEMENT: "Agreement",
      DONE: "Done",

      PENDING: "Pending",
      PARTIAL: "Partial",
      PAID: "Paid",
      OVERDUE: "Overdue",

      PENDING_APPROVAL: "Pending Approval",
      APPROVED: "Approved",
      VERIFIED: "Verified",
      REJECTED: "Rejected",
      FLAGGED: "Flagged",

      ACTIVE: "Active",
      SUSPENDED: "Suspended",
      TRIAL: "Trial",
    },
  },

  ur: {
    locale: { switchTo: "English", label: "زبان تبدیل کریں" },

    nav: {
      dashboard: "ڈیش بورڈ",
      properties: "جائیدادیں",
      map: "نقشہ",
      leads: "لیڈز",
      deals: "سودے",
      calendar: "کیلنڈر",
      visits: "دورے",
      commissions: "کمیشن",
      payments: "ادائیگیاں",
      agents: "ایجنٹس",
      dealers: "ڈیلرز",
      documents: "دستاویزات",
      reports: "رپورٹس",
      activityLog: "سرگرمی لاگ",
      notifications: "اطلاعات",
      settings: "ترتیبات",
      companies: "کمپنیاں",
    },

    groups: {
      workspace: "ورک سپیس",
      sales: "سیلز",
      field: "فیلڈ",
      finance: "مالیات",
      people: "لوگ",
      insights: "بصیرت",
      system: "سسٹم",
    },

    shell: {
      collapse: "سکیڑیں",
      signOut: "لاگ آؤٹ",
      searchPlaceholder: "جائیدادیں، لیڈز، سودے تلاش کریں…",
      searchInner: "جائیدادیں، لیڈز، سودے، کلائنٹس تلاش کریں…",
      searchFor: "تلاش کریں",
      recent: "حالیہ",
      jumpTo: "جائیں",
      notifications: "اطلاعات",
    },

    common: {
      viewAll: "سب دیکھیں",
      allLeads: "تمام لیڈز",
      reports: "رپورٹس",
      calendar: "کیلنڈر",
      fullCalendar: "مکمل کیلنڈر",
      review: "جائزہ",
      noActivity: "ابھی تک کوئی سرگرمی درج نہیں ہے۔",
      noResults: "کوئی نتیجہ نہیں۔",
      total: "کل",
      peak: "عروج",
      available: "دستیاب",
    },

    login: {
      tagline: "ریئل اسٹیٹ CRM / ERP",
      heroTitle: "جائیدادوں، لوگوں، سودوں اور پیسوں کا ایک ہی گھر۔",
      heroSubtitle:
        "لسٹنگ، لیڈز، ایجنٹس، ڈیلرز، کمیشن، ادائیگیاں اور رپورٹنگ چلائیں — دفتر اور میدان دونوں کے لیے۔",
      welcomeBack: "خوش آمدید",
      subtitle: "جاری رکھنے کے لیے اپنے ورک سپیس میں سائن ان کریں۔",
      email: "ای میل",
      password: "پاس ورڈ",
      show: "دکھائیں",
      hide: "چھپائیں",
      signIn: "سائن ان",
      signingIn: "سائن ان ہو رہا ہے…",
      demoAccounts: "ڈیمو اکاؤنٹس",
      feat: {
        dashboards: "کردار کے مطابق ڈیش بورڈز",
        field: "فیلڈ چیک ان اور دورے",
        commission: "لچکدار کمیشن نظام",
        docs: "دستاویزات اور رپورٹس",
      },
      copyright: "ریئل اسٹیٹ CRM اور ERP",
    },

    dashboard: {
      owner: {
        eyebrow: "اونر ڈیش بورڈ",
        title: "کاروبار کیسا چل رہا ہے",
        subtitle:
          "آمدنی، کمیشن، پائپ لائن اور انہیں چلانے والے لوگ — ایک ہی جگہ۔",
      },
      admin: {
        eyebrow: "ایڈمن ڈیش بورڈ",
        title: "آج کس چیز پر توجہ درکار ہے",
        subtitle:
          "آپریشنز ایک نظر میں — تفویض، تصدیق اور منظوریاں۔",
      },
      dealer: { eyebrow: "ڈیلر ڈیش بورڈ" },
      agent: {
        morning: "صبح بخیر",
        afternoon: "دوپہر بخیر",
        evening: "شام بخیر",
        heroLead: "— آج کا دن کارآمد بنائیں۔",
        heroSub: "آج کا شیڈول، آپ کے لیڈز اور آپ کی کمائی۔",
      },
      deltaFlat: "پچھلے ماہ کے برابر",
      deltaUp: "پچھلے ماہ سے",
      deltaDown: "پچھلے ماہ سے",
      allTimeRevenue: "کل آمدنی:",
      revenueTotalLabel: "ماہ کی کل فروخت",
    },

    stats: {
      revenueThisMonth: "اس ماہ کی آمدنی",
      commissionPending: "زیر التواء کمیشن",
      openDeals: "جاری سودے",
      overduePayments: "میعاد گزرہ ادائیگیاں",
      inPipeline: "پائپ لائن میں",
      outstanding: "بقایا",
      paid: "ادا شدہ",
      leadsToAssign: "تفویض کے منتظر لیڈز",
      visitsToVerify: "تصدیق کے منتظر دورے",
      docsToCheck: "جانچ کے منتظر دستاویزات",
      paymentsDue: "واجب ادائیگیاں",
      pendingOverdue: "زیر التواء + میعاد گزرہ",
      todaysTasks: "آج کے کام",
      activeLeads: "فعال لیڈز",
      properties: "جائیدادیں",
      inventory: "انوینٹری",
      dealsClosed: "مکمل سودے",
      shareEarned: "کمایا گیا حصہ",
      sharePending: "زیر التواء حصہ",
      earned: "کمائے",
    },

    sections: {
      revenueTrend: "آمدنی کا رجحان · پچھلے 6 ماہ",
      inventoryMix: "انوینٹری کی تقسیم",
      leadPipeline: "لیڈ پائپ لائن",
      agentLeaderboard: "ایجنٹس کی فہرست",
      todaysSchedule: "آج کا شیڈول",
      todaysCalendar: "آج کا کیلنڈر",
      yourActiveLeads: "آپ کے فعال لیڈز",
      commissionsAwaitingApproval: "منظوری کے منتظر کمیشن",
      yourInventory: "آپ کی انوینٹری",
      dealsThroughInventory: "آپ کی انوینٹری سے سودے",
    },

    empty: {
      noAgents: "ابھی کوئی ایجنٹ نہیں ہے۔",
      noProperties: "ابھی کوئی جائیداد نہیں ہے۔",
      noAppointmentsToday:
        "آج کوئی ملاقات نہیں ہے۔ لیڈز کا تعاقب کرنے کا وقت ہے!",
      noActiveLeads: "کوئی فعال لیڈ تفویض نہیں ہے۔",
      nothingScheduled: "آج کے لیے کچھ شیڈول نہیں ہے۔",
      nothingPending: "کوئی منظوری زیر التواء نہیں۔",
      noLinkedProperties: "آپ کے پروفائل سے کوئی جائیداد منسلک نہیں۔",
      noClosedDeals: "ابھی کوئی مکمل سودا نہیں۔",
      noDealerProfile:
        "آپ کے اکاؤنٹ سے ابھی کوئی ڈیلر پروفائل منسلک نہیں۔ ایڈمن سے کہیں۔",
    },

    units: {
      won: "جیتے",
      conversion: "تبدیلی",
      leads: "لیڈز",
    },

    status: {
      AVAILABLE: "دستیاب",
      RESERVED: "محفوظ",
      UNDER_NEGOTIATION: "زیر مذاکرات",
      RENTED: "کرایہ پر",
      SOLD: "فروخت شدہ",
      INACTIVE: "غیر فعال",
      PENDING_VERIFICATION: "تصدیق طلب",

      NEW: "نیا",
      CONTACTED: "رابطہ ہوا",
      INTERESTED: "دلچسپی",
      SITE_VISIT: "سائٹ وزٹ",
      PROPERTY_SHOWN: "جائیداد دکھائی گئی",
      NEGOTIATION: "مذاکرات",
      TOKEN_BOOKING: "ٹوکن بکنگ",
      PAYMENT: "ادائیگی",
      CLOSED_WON: "کامیاب",
      CLOSED_LOST: "ناکام",

      DRAFT: "مسودہ",
      TOKEN: "ٹوکن",
      BOOKED: "بک شدہ",
      AGREEMENT: "معاہدہ",
      DONE: "مکمل",

      PENDING: "زیر التواء",
      PARTIAL: "جزوی",
      PAID: "ادا شدہ",
      OVERDUE: "میعاد گزرہ",

      PENDING_APPROVAL: "منظوری کا منتظر",
      APPROVED: "منظور شدہ",
      VERIFIED: "تصدیق شدہ",
      REJECTED: "مسترد",
      FLAGGED: "نشان زد",

      ACTIVE: "فعال",
      SUSPENDED: "معطل",
      TRIAL: "آزمائشی",
    },
  },
} as const;

/** Widen literal string types so DICT.en and DICT.ur are mutually assignable. */
type Widen<T> = T extends string
  ? string
  : { [K in keyof T]: Widen<T[K]> };

export type Dict = Widen<(typeof DICT)["en"]>;
