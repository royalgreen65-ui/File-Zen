# FileZen - AI File Organizer

An intelligent desktop orchestrator that uses Gemini AI to clean up and organize your folders.

## How to Run Locally

### 1. Prerequisite: Node.js
This app requires **Node.js** to serve the files correctly (browsers block file system access if you just open the `index.html` file directly).
- Download it here: [https://nodejs.org/](https://nodejs.org/)

### 2. Launch the App
- **Windows 11 / 10**: Double-click `run.bat`.
- **Mac / Linux**: Open Terminal in this folder and type `sh run.sh`.

### 3. Open in Browser
Once the script is running, open your browser (Chrome or Edge recommended) and go to:
`http://localhost:3000`

---

## Troubleshooting (Windows 11)

If `run.bat` closes immediately or shows an error:

1. **"Node is not recognized"**: You need to install Node.js (see Step 1 above). If you just installed it, **restart your computer** to update your system paths.
2. **Windows Protected your PC**: Windows 11 often blocks `.bat` files from the internet. 
   - Right-click `run.bat` -> **Properties**.
   - Check the **"Unblock"** box at the bottom and click **Apply**.
3. **Running via PowerShell**: If double-clicking doesn't work, right-click inside the folder, select **"Open in Terminal"**, and type:
   ```powershell
   npx serve .
   ```

## Installation (Desktop App)
Once the app is running in **Chrome** or **Edge**:
1. Look at the right side of the Address Bar.
2. Click the **"Install FileZen"** icon (looks like a monitor with an arrow).
3. The app will now behave like a native Windows 11 desktop program.
