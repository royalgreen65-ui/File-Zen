
# FileZen - Windows AI Utility

A high-fidelity system tool that uses Gemini AI to clean up and organize your local folders (Downloads, Documents, Desktop, etc).

## 🚀 Native EXE Experience on Windows 11

To make FileZen behave like a standard Windows `.exe` with a Taskbar icon and a standalone window:

1.  **Start the Utility**:
    Ensure you have [Node.js](https://nodejs.org/) installed. In this folder, run:
    ```powershell
    npm start
    ```

2.  **Create Desktop Shortcut**:
    Right-click `CreateShortcut.ps1` and select **"Run with PowerShell"**. 
    *This creates a "FileZen" shortcut on your Desktop.*

3.  **Launch from Desktop**:
    Double-click the new Desktop Shortcut. FileZen will open in a **Native App Window** (no browser tabs, no address bar).

---

## 🛠 Features for Power Users

-   **Mica Architecture**: Follows Windows 11 Fluent Design guidelines.
-   **Gemini Intelligence**: Uses Google's latest `gemini-3-flash-preview` for high-accuracy file classification.
-   **Secure File System Access**: Uses the modern `FileSystemDirectoryHandle` API for direct local disk interaction.
-   **Eye-Friendly Mode**: Intelligent Light and Dark themes optimized for long-term usage.

## Troubleshooting

- **"Access Denied"**: This is a security feature of Windows. When the app asks for folder access, click "Allow" in the browser prompt.
- **Shortcut doesn't open**: Ensure the local server (`npm start`) is still running in the background.
