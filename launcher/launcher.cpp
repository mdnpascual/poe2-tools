// launcher.cpp — Tiny Win32 splash launcher for PoE2-Tools
// Compile: cl /O2 /DNDEBUG launcher.cpp /link /SUBSYSTEM:WINDOWS user32.lib gdi32.lib shell32.lib
// Or with MinGW: g++ -O2 -mwindows launcher.cpp -o launcher.exe -luser32 -lgdi32 -lshell32

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>

static const wchar_t* SPLASH_CLASS = L"PoE2ToolsSplash";
static const wchar_t* APP_EXE = L"poe2-tools.exe";
static const wchar_t* APP_WINDOW_TITLE = L"poe2-tools"; // partial match
static HWND splashHwnd = NULL;

LRESULT CALLBACK SplashProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        GetClientRect(hwnd, &rc);

        // Dark background
        HBRUSH bg = CreateSolidBrush(RGB(26, 26, 46));
        FillRect(hdc, &rc, bg);
        DeleteObject(bg);

        // Title text
        SetBkMode(hdc, TRANSPARENT);
        SetTextColor(hdc, RGB(229, 231, 235));
        HFONT titleFont = CreateFontW(28, 0, 0, 0, FW_BOLD, 0, 0, 0, 0, 0, 0, 0, 0, L"Consolas");
        HFONT old = (HFONT)SelectObject(hdc, titleFont);
        RECT titleRc = { rc.left, rc.top + 60, rc.right, rc.top + 100 };
        DrawTextW(hdc, L"PoE2 Tools", -1, &titleRc, DT_CENTER | DT_SINGLELINE);
        SelectObject(hdc, old);
        DeleteObject(titleFont);

        // Loading text
        SetTextColor(hdc, RGB(156, 163, 175));
        HFONT subFont = CreateFontW(16, 0, 0, 0, FW_NORMAL, 0, 0, 0, 0, 0, 0, 0, 0, L"Consolas");
        old = (HFONT)SelectObject(hdc, subFont);
        RECT subRc = { rc.left, rc.top + 110, rc.right, rc.top + 140 };
        DrawTextW(hdc, L"Loading...", -1, &subRc, DT_CENTER | DT_SINGLELINE);
        SelectObject(hdc, old);
        DeleteObject(subFont);

        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

BOOL CALLBACK FindAppWindow(HWND hwnd, LPARAM lp) {
    wchar_t title[256];
    GetWindowTextW(hwnd, title, 256);
    if (wcsstr(title, APP_WINDOW_TITLE) && IsWindowVisible(hwnd)) {
        *(HWND*)lp = hwnd;
        return FALSE; // stop
    }
    return TRUE;
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, LPWSTR, int) {
    // Register splash window class
    WNDCLASSW wc = {};
    wc.lpfnWndProc = SplashProc;
    wc.hInstance = hInst;
    wc.lpszClassName = SPLASH_CLASS;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassW(&wc);

    // Create centered splash
    int sw = GetSystemMetrics(SM_CXSCREEN);
    int sh = GetSystemMetrics(SM_CYSCREEN);
    int w = 300, h = 200;
    splashHwnd = CreateWindowExW(
        WS_EX_TOPMOST,
        SPLASH_CLASS, L"",
        WS_POPUP | WS_VISIBLE,
        (sw - w) / 2, (sh - h) / 2, w, h,
        NULL, NULL, hInst, NULL);
    UpdateWindow(splashHwnd);

    // Launch the real exe
    wchar_t exePath[MAX_PATH];
    GetModuleFileNameW(NULL, exePath, MAX_PATH);
    // Find directory of launcher
    wchar_t* lastSlash = wcsrchr(exePath, L'\\');
    if (lastSlash) *(lastSlash + 1) = 0;
    wcscat_s(exePath, APP_EXE);

    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi = {};
    CreateProcessW(exePath, NULL, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi);
    CloseHandle(pi.hThread);

    // Poll until app window appears or timeout (15s)
    DWORD start = GetTickCount();
    while (GetTickCount() - start < 15000) {
        // Process splash messages
        MSG msg;
        while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        // Check if app window appeared
        HWND found = NULL;
        EnumWindows(FindAppWindow, (LPARAM)&found);
        if (found) break;

        Sleep(200);
    }

    // Close splash
    DestroyWindow(splashHwnd);
    CloseHandle(pi.hProcess);
    return 0;
}
