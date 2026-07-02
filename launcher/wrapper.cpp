// wrapper.cpp — Self-extracting splash wrapper for PoE2-Tools
// The real exe is appended after this binary with a size trailer (8 bytes, little-endian uint64).
// Compile: cl /O2 /DNDEBUG wrapper.cpp /Fe:wrapper.exe /link /SUBSYSTEM:WINDOWS user32.lib gdi32.lib shell32.lib
// Then append payload: node scripts/pack-wrapper.js

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>

static const wchar_t* SPLASH_CLASS = L"PoE2ToolsSplash";
static const wchar_t* APP_WINDOW_TITLE = L"poe2-tools";
static HWND splashHwnd = NULL;

LRESULT CALLBACK SplashProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        GetClientRect(hwnd, &rc);

        HBRUSH bg = CreateSolidBrush(RGB(26, 26, 46));
        FillRect(hdc, &rc, bg);
        DeleteObject(bg);

        SetBkMode(hdc, TRANSPARENT);
        SetTextColor(hdc, RGB(229, 231, 235));
        HFONT titleFont = CreateFontW(28, 0, 0, 0, FW_BOLD, 0, 0, 0, 0, 0, 0, 0, 0, L"Consolas");
        HFONT old = (HFONT)SelectObject(hdc, titleFont);
        RECT titleRc = { rc.left, rc.top + 60, rc.right, rc.top + 100 };
        DrawTextW(hdc, L"PoE2 Tools", -1, &titleRc, DT_CENTER | DT_SINGLELINE);
        SelectObject(hdc, old);
        DeleteObject(titleFont);

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
        return FALSE;
    }
    return TRUE;
}

void pumpMessages() {
    MSG msg;
    while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, LPWSTR, int) {
    // Show splash immediately
    WNDCLASSW wc = {};
    wc.lpfnWndProc = SplashProc;
    wc.hInstance = hInst;
    wc.lpszClassName = SPLASH_CLASS;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassW(&wc);

    int sw = GetSystemMetrics(SM_CXSCREEN);
    int sh = GetSystemMetrics(SM_CYSCREEN);
    int w = 300, h = 200;
    splashHwnd = CreateWindowExW(
        WS_EX_TOPMOST, SPLASH_CLASS, L"",
        WS_POPUP | WS_VISIBLE,
        (sw - w) / 2, (sh - h) / 2, w, h,
        NULL, NULL, hInst, NULL);
    UpdateWindow(splashHwnd);
    pumpMessages();

    // Read payload size from last 8 bytes of ourselves
    wchar_t selfPath[MAX_PATH];
    GetModuleFileNameW(NULL, selfPath, MAX_PATH);

    HANDLE hSelf = CreateFileW(selfPath, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (hSelf == INVALID_HANDLE_VALUE) { DestroyWindow(splashHwnd); return 1; }

    LARGE_INTEGER fileSize;
    GetFileSizeEx(hSelf, &fileSize);

    // Last 8 bytes = payload size (little-endian uint64)
    LARGE_INTEGER trailerPos;
    trailerPos.QuadPart = fileSize.QuadPart - 8;
    SetFilePointerEx(hSelf, trailerPos, NULL, FILE_BEGIN);
    unsigned __int64 payloadSize = 0;
    DWORD bytesRead = 0;
    ReadFile(hSelf, &payloadSize, 8, &bytesRead, NULL);

    if (payloadSize == 0 || payloadSize > (unsigned __int64)fileSize.QuadPart) {
        CloseHandle(hSelf);
        DestroyWindow(splashHwnd);
        return 1;
    }

    // Extract payload to temp
    wchar_t tempDir[MAX_PATH];
    GetTempPathW(MAX_PATH, tempDir);
    wchar_t tempExe[MAX_PATH];
    wsprintfW(tempExe, L"%spoe2-tools.exe", tempDir);

    // Skip extraction if already exists and same size
    BOOL needExtract = TRUE;
    WIN32_FILE_ATTRIBUTE_DATA fad;
    if (GetFileAttributesExW(tempExe, GetFileExInfoStandard, &fad)) {
        LARGE_INTEGER existingSize;
        existingSize.HighPart = fad.nFileSizeHigh;
        existingSize.LowPart = fad.nFileSizeLow;
        if ((unsigned __int64)existingSize.QuadPart == payloadSize) {
            needExtract = FALSE;
        }
    }

    if (needExtract) {
        // Seek to payload start
        LARGE_INTEGER payloadPos;
        payloadPos.QuadPart = fileSize.QuadPart - 8 - payloadSize;
        SetFilePointerEx(hSelf, payloadPos, NULL, FILE_BEGIN);

        HANDLE hOut = CreateFileW(tempExe, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        if (hOut == INVALID_HANDLE_VALUE) { CloseHandle(hSelf); DestroyWindow(splashHwnd); return 1; }

        char buf[65536];
        unsigned __int64 remaining = payloadSize;
        while (remaining > 0) {
            DWORD toRead = (remaining > sizeof(buf)) ? sizeof(buf) : (DWORD)remaining;
            DWORD read = 0;
            ReadFile(hSelf, buf, toRead, &read, NULL);
            if (read == 0) break;
            DWORD written = 0;
            WriteFile(hOut, buf, read, &written, NULL);
            remaining -= read;
            pumpMessages(); // keep splash responsive
        }
        CloseHandle(hOut);
    }
    CloseHandle(hSelf);

    // Launch extracted exe
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi = {};
    CreateProcessW(tempExe, NULL, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi);
    CloseHandle(pi.hThread);

    // Poll until app window appears (30s timeout for first extraction)
    DWORD start = GetTickCount();
    while (GetTickCount() - start < 30000) {
        pumpMessages();
        HWND found = NULL;
        EnumWindows(FindAppWindow, (LPARAM)&found);
        if (found) break;
        Sleep(200);
    }

    DestroyWindow(splashHwnd);
    CloseHandle(pi.hProcess);
    return 0;
}
