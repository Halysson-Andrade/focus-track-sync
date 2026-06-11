// Mapeia process_name -> label amigável. Fallback = nome do processo sem extensão.
const MAP = {
  "code.exe": "Visual Studio Code",
  "code": "Visual Studio Code",
  "code - insiders.exe": "VS Code Insiders",
  "cursor.exe": "Cursor",
  "cursor": "Cursor",
  "windsurf.exe": "Windsurf",
  "devenv.exe": "Visual Studio",
  "rider64.exe": "JetBrains Rider",
  "idea64.exe": "IntelliJ IDEA",
  "webstorm64.exe": "WebStorm",
  "pycharm64.exe": "PyCharm",
  "phpstorm64.exe": "PhpStorm",
  "datagrip64.exe": "DataGrip",
  "dbeaver.exe": "DBeaver",
  "dbeaver": "DBeaver",
  "ssms.exe": "SQL Server Management Studio",
  "mysqlworkbench.exe": "MySQL Workbench",
  "pgadmin4.exe": "pgAdmin",
  "chrome.exe": "Google Chrome",
  "google chrome": "Google Chrome",
  "msedge.exe": "Microsoft Edge",
  "firefox.exe": "Firefox",
  "brave.exe": "Brave",
  "arc.exe": "Arc",
  "safari": "Safari",
  "photoshop.exe": "Adobe Photoshop",
  "illustrator.exe": "Adobe Illustrator",
  "afterfx.exe": "After Effects",
  "premiere.exe": "Premiere Pro",
  "figma.exe": "Figma",
  "figma": "Figma",
  "slack.exe": "Slack",
  "slack": "Slack",
  "discord.exe": "Discord",
  "teams.exe": "Microsoft Teams",
  "ms-teams.exe": "Microsoft Teams",
  "zoom.exe": "Zoom",
  "whatsapp.exe": "WhatsApp",
  "telegram.exe": "Telegram",
  "outlook.exe": "Outlook",
  "winword.exe": "Word",
  "excel.exe": "Excel",
  "powerpnt.exe": "PowerPoint",
  "notion.exe": "Notion",
  "obsidian.exe": "Obsidian",
  "terminal.exe": "Terminal",
  "windowsterminal.exe": "Windows Terminal",
  "powershell.exe": "PowerShell",
  "cmd.exe": "Prompt de Comando",
  "iterm.app": "iTerm",
  "explorer.exe": "Explorador de Arquivos",
  "finder": "Finder",
};

function labelFor(processName) {
  if (!processName) return "Desconhecido";
  const key = processName.toLowerCase();
  if (MAP[key]) return MAP[key];
  // remove extensão e capitaliza
  const base = key.replace(/\.(exe|app)$/i, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

module.exports = { labelFor };
