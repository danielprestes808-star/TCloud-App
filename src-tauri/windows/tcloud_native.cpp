// TCloud Windows native compatibility bridge.
// Keep this translation unit buildable across Visual Studio/Windows SDK setups.
// Optional APIs are detected at compile time and degrade gracefully instead of
// preventing the entire Tauri application from compiling.

#include <algorithm>
#include <cstddef>
#include <cwchar>
#include <filesystem>
#include <string>
#include <vector>

#if defined(_WIN32) && __has_include(<windows.h>)
#  define TCLOUD_HAS_WIN32 1
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#else
#  define TCLOUD_HAS_WIN32 0
#endif

#if TCLOUD_HAS_WIN32 && __has_include(<cfapi.h>)
#  define TCLOUD_HAS_CFAPI 1
#  include <cfapi.h>
#else
#  define TCLOUD_HAS_CFAPI 0
#endif

#if TCLOUD_HAS_WIN32 && __has_include(<wincrypt.h>)
#  define TCLOUD_HAS_DPAPI 1
#  include <wincrypt.h>
#else
#  define TCLOUD_HAS_DPAPI 0
#endif

#if TCLOUD_HAS_WIN32 && \
    __has_include(<winrt/base.h>) && \
    __has_include(<winrt/Windows.Security.Credentials.UI.h>)
#  define TCLOUD_HAS_HELLO_WINRT 1
#  include <winrt/base.h>
#  include <winrt/Windows.Security.Credentials.UI.h>
#else
#  define TCLOUD_HAS_HELLO_WINRT 0
#endif

#if TCLOUD_HAS_WIN32 && \
    __has_include(<winrt/base.h>) && \
    __has_include(<winrt/Windows.Storage.h>) && \
    __has_include(<winrt/Windows.Graphics.Imaging.h>) && \
    __has_include(<winrt/Windows.Media.Ocr.h>)
#  define TCLOUD_HAS_OCR_WINRT 1
#  if !TCLOUD_HAS_HELLO_WINRT
#    include <winrt/base.h>
#  endif
#  include <winrt/Windows.Storage.h>
#  include <winrt/Windows.Graphics.Imaging.h>
#  include <winrt/Windows.Media.Ocr.h>
#else
#  define TCLOUD_HAS_OCR_WINRT 0
#endif

namespace {
void write_error(wchar_t* out, size_t cap, const std::wstring& msg) {
    if (!out || cap == 0) return;
    const size_t count = (std::min)(cap - 1, msg.size());
    if (count > 0) std::wmemcpy(out, msg.data(), count);
    out[count] = L'\0';
}

#if TCLOUD_HAS_WIN32
std::wstring win32_message(unsigned long code) {
    wchar_t* buffer = nullptr;
    const DWORD flags = FORMAT_MESSAGE_ALLOCATE_BUFFER |
                        FORMAT_MESSAGE_FROM_SYSTEM |
                        FORMAT_MESSAGE_IGNORE_INSERTS;
    const DWORD len = FormatMessageW(
        flags,
        nullptr,
        static_cast<DWORD>(code),
        0,
        reinterpret_cast<wchar_t*>(&buffer),
        0,
        nullptr);
    std::wstring result = (len && buffer)
        ? std::wstring(buffer, len)
        : (L"Windows error " + std::to_wstring(static_cast<unsigned long long>(code)));
    if (buffer) LocalFree(buffer);
    return result;
}

std::wstring hresult_message(HRESULT hr) {
    return win32_message(static_cast<unsigned long>(hr));
}
#endif

#if TCLOUD_HAS_HELLO_WINRT || TCLOUD_HAS_OCR_WINRT
void ensure_apartment() {
    try {
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
    } catch (const winrt::hresult_error& e) {
        // WebView/Tauri may have initialized COM already on this thread.
        if (e.code() != RPC_E_CHANGED_MODE) throw;
    }
}
#endif
}

extern "C" int tcloud_cfapi_platform_supported() {
#if TCLOUD_HAS_CFAPI
    CF_PLATFORM_INFO info{};
    info.StructSize = sizeof(info);
    return SUCCEEDED(CfGetPlatformInfo(&info)) ? 1 : 0;
#else
    return 0;
#endif
}

extern "C" int tcloud_cfapi_register(
    const wchar_t* root_path,
    const wchar_t* version,
    wchar_t* error,
    size_t error_cap) {
#if TCLOUD_HAS_CFAPI
    if (!root_path || !*root_path) {
        write_error(error, error_cap, L"Sync root path is empty");
        return 0;
    }

    try {
        std::filesystem::create_directories(std::filesystem::path(root_path));
    } catch (...) {
        write_error(error, error_cap, L"Could not create the CFAPI sync root directory");
        return 0;
    }

    CF_SYNC_REGISTRATION registration{};
    registration.StructSize = sizeof(registration);
    registration.ProviderName = L"TCloud";
    registration.ProviderVersion = (version && *version) ? version : L"10";
    static const char identity[] = "TCloud-CFAPI-v1";
    registration.SyncRootIdentity = identity;
    registration.SyncRootIdentityLength = static_cast<DWORD>(sizeof(identity) - 1);
    registration.FileIdentity = nullptr;
    registration.FileIdentityLength = 0;

    // Avoid SDK-version-sensitive aggregate initialization of ProviderId.
    registration.ProviderId.Data1 = 0x7c124b59;
    registration.ProviderId.Data2 = 0x8ef6;
    registration.ProviderId.Data3 = 0x4c69;
    const unsigned char data4[8] = {0x9a,0x9e,0x2d,0x91,0xc7,0xa4,0x10,0x55};
    for (size_t i = 0; i < 8; ++i) registration.ProviderId.Data4[i] = data4[i];

    CF_SYNC_POLICIES policies{};
    policies.StructSize = sizeof(policies);
    policies.Hydration.Primary = CF_HYDRATION_POLICY_FULL;
    policies.Hydration.Modifier = CF_HYDRATION_POLICY_MODIFIER_NONE;
    policies.Population.Primary = CF_POPULATION_POLICY_ALWAYS_FULL;
    policies.Population.Modifier = CF_POPULATION_POLICY_MODIFIER_NONE;
    policies.InSync = CF_INSYNC_POLICY_NONE;
    policies.HardLink = CF_HARDLINK_POLICY_NONE;
    policies.PlaceholderManagement = CF_PLACEHOLDER_MANAGEMENT_POLICY_DEFAULT;

    const HRESULT hr = CfRegisterSyncRoot(
        root_path,
        &registration,
        &policies,
        static_cast<CF_REGISTER_FLAGS>(CF_REGISTER_FLAG_UPDATE | CF_REGISTER_FLAG_MARK_IN_SYNC_ON_ROOT));

    if (FAILED(hr)) {
        write_error(error, error_cap, hresult_message(hr));
        return 0;
    }
    return 1;
#else
    (void)root_path; (void)version;
    write_error(error, error_cap,
        L"CFAPI headers are not installed in this Windows SDK. Native Explorer integration is unavailable in this build.");
    return 0;
#endif
}

extern "C" int tcloud_cfapi_unregister(
    const wchar_t* root_path,
    wchar_t* error,
    size_t error_cap) {
#if TCLOUD_HAS_CFAPI
    if (!root_path || !*root_path) {
        write_error(error, error_cap, L"Sync root path is empty");
        return 0;
    }
    const HRESULT hr = CfUnregisterSyncRoot(root_path);
    if (FAILED(hr)) {
        write_error(error, error_cap, hresult_message(hr));
        return 0;
    }
    return 1;
#else
    (void)root_path;
    write_error(error, error_cap, L"CFAPI is unavailable in this Windows SDK");
    return 0;
#endif
}

extern "C" int tcloud_windows_hello_available(wchar_t* error, size_t error_cap) {
#if TCLOUD_HAS_HELLO_WINRT
    try {
        ensure_apartment();
        using namespace winrt::Windows::Security::Credentials::UI;
        const auto availability = UserConsentVerifier::CheckAvailabilityAsync().get();
        if (availability == UserConsentVerifierAvailability::Available) return 1;
        write_error(error, error_cap, L"Windows Hello is not configured or not available for this Windows account");
        return 0;
    } catch (const winrt::hresult_error& e) {
        write_error(error, error_cap, e.message().c_str());
        return 0;
    } catch (...) {
        write_error(error, error_cap, L"Windows Hello availability check failed");
        return 0;
    }
#else
    write_error(error, error_cap,
        L"Windows Hello C++/WinRT headers are not installed. Install a recent Windows SDK to enable this optional feature.");
    return 0;
#endif
}

extern "C" int tcloud_windows_hello_verify(
    const wchar_t* prompt,
    wchar_t* error,
    size_t error_cap) {
#if TCLOUD_HAS_HELLO_WINRT
    try {
        ensure_apartment();
        using namespace winrt::Windows::Security::Credentials::UI;
        const winrt::hstring message = (prompt && *prompt)
            ? winrt::hstring(prompt)
            : winrt::hstring(L"Confirmar acesso ao TCloud");
        const auto result = UserConsentVerifier::RequestVerificationAsync(message).get();
        if (result == UserConsentVerificationResult::Verified) return 1;
        write_error(error, error_cap, L"Windows Hello verification was not confirmed");
        return 0;
    } catch (const winrt::hresult_error& e) {
        write_error(error, error_cap, e.message().c_str());
        return 0;
    } catch (...) {
        write_error(error, error_cap, L"Windows Hello verification failed");
        return 0;
    }
#else
    (void)prompt;
    write_error(error, error_cap,
        L"Windows Hello C++/WinRT headers are not installed in this Windows SDK");
    return 0;
#endif
}

extern "C" int tcloud_dpapi_protect(
    const wchar_t* text,
    const wchar_t* output_path,
    wchar_t* error,
    size_t error_cap) {
#if TCLOUD_HAS_DPAPI
    if (!text || !output_path) {
        write_error(error, error_cap, L"Invalid DPAPI input");
        return 0;
    }

    DATA_BLOB input{};
    input.pbData = reinterpret_cast<BYTE*>(const_cast<wchar_t*>(text));
    input.cbData = static_cast<DWORD>((std::wcslen(text) + 1) * sizeof(wchar_t));

    static BYTE entropy_bytes[] = {'T','C','l','o','u','d','-','V','a','u','l','t'};
    DATA_BLOB entropy{};
    entropy.pbData = entropy_bytes;
    entropy.cbData = static_cast<DWORD>(sizeof(entropy_bytes));

    DATA_BLOB output{};
    if (!CryptProtectData(
            &input,
            L"TCloud Vault",
            &entropy,
            nullptr,
            nullptr,
            CRYPTPROTECT_UI_FORBIDDEN,
            &output)) {
        write_error(error, error_cap, win32_message(GetLastError()));
        return 0;
    }

    HANDLE file = CreateFileW(
        output_path, GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
        FILE_ATTRIBUTE_HIDDEN, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        if (output.pbData) {
            SecureZeroMemory(output.pbData, output.cbData);
            LocalFree(output.pbData);
        }
        write_error(error, error_cap, win32_message(GetLastError()));
        return 0;
    }

    DWORD written = 0;
    const BOOL ok = WriteFile(file, output.pbData, output.cbData, &written, nullptr);
    CloseHandle(file);
    SecureZeroMemory(output.pbData, output.cbData);
    LocalFree(output.pbData);

    if (!ok || written != output.cbData) {
        write_error(error, error_cap, L"Could not save the DPAPI-protected TCloud credential");
        return 0;
    }
    return 1;
#else
    (void)text; (void)output_path;
    write_error(error, error_cap, L"Windows DPAPI headers are unavailable in this SDK");
    return 0;
#endif
}

extern "C" int tcloud_dpapi_unprotect(
    const wchar_t* input_path,
    wchar_t* output_text,
    size_t output_cap,
    wchar_t* error,
    size_t error_cap) {
#if TCLOUD_HAS_DPAPI
    if (!input_path || !output_text || output_cap == 0) {
        write_error(error, error_cap, L"Invalid DPAPI input");
        return 0;
    }

    HANDLE file = CreateFileW(
        input_path, GENERIC_READ, FILE_SHARE_READ, nullptr,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        write_error(error, error_cap, L"Protected credential not found");
        return 0;
    }

    const DWORD size = GetFileSize(file, nullptr);
    if (size == INVALID_FILE_SIZE || size == 0 || size > 1024 * 1024) {
        CloseHandle(file);
        write_error(error, error_cap, L"Invalid protected credential");
        return 0;
    }

    std::vector<BYTE> bytes(size);
    DWORD read = 0;
    const BOOL read_ok = ReadFile(file, bytes.data(), size, &read, nullptr);
    CloseHandle(file);
    if (!read_ok || read != size) {
        write_error(error, error_cap, L"Could not read protected credential");
        return 0;
    }

    DATA_BLOB input{};
    input.pbData = bytes.data();
    input.cbData = size;

    static BYTE entropy_bytes[] = {'T','C','l','o','u','d','-','V','a','u','l','t'};
    DATA_BLOB entropy{};
    entropy.pbData = entropy_bytes;
    entropy.cbData = static_cast<DWORD>(sizeof(entropy_bytes));

    DATA_BLOB output{};
    if (!CryptUnprotectData(
            &input, nullptr, &entropy, nullptr, nullptr,
            CRYPTPROTECT_UI_FORBIDDEN, &output)) {
        SecureZeroMemory(bytes.data(), bytes.size());
        write_error(error, error_cap, win32_message(GetLastError()));
        return 0;
    }

    const wchar_t* decoded = reinterpret_cast<const wchar_t*>(output.pbData);
    const size_t decoded_cap = output.cbData / sizeof(wchar_t);
    size_t decoded_len = 0;
    while (decoded_len < decoded_cap && decoded[decoded_len] != L'\0') ++decoded_len;
    const size_t copy_len = (std::min)(output_cap - 1, decoded_len);
    if (copy_len > 0) std::wmemcpy(output_text, decoded, copy_len);
    output_text[copy_len] = L'\0';

    SecureZeroMemory(bytes.data(), bytes.size());
    SecureZeroMemory(output.pbData, output.cbData);
    LocalFree(output.pbData);
    return 1;
#else
    (void)input_path; (void)output_text; (void)output_cap;
    write_error(error, error_cap, L"Windows DPAPI headers are unavailable in this SDK");
    return 0;
#endif
}

extern "C" int tcloud_ocr_image(
    const wchar_t* input_path,
    wchar_t* output_text,
    size_t output_cap,
    wchar_t* error,
    size_t error_cap) {
#if TCLOUD_HAS_OCR_WINRT
    if (!input_path || !output_text || output_cap == 0) {
        write_error(error, error_cap, L"Invalid OCR input");
        return 0;
    }
    try {
        ensure_apartment();
        using namespace winrt::Windows::Storage;
        using namespace winrt::Windows::Graphics::Imaging;
        using namespace winrt::Windows::Media::Ocr;

        const auto file = StorageFile::GetFileFromPathAsync(input_path).get();
        const auto stream = file.OpenReadAsync().get();
        const auto decoder = BitmapDecoder::CreateAsync(stream).get();
        const auto bitmap = decoder.GetSoftwareBitmapAsync(
            BitmapPixelFormat::Bgra8,
            BitmapAlphaMode::Premultiplied).get();
        const auto engine = OcrEngine::TryCreateFromUserProfileLanguages();
        if (!engine) {
            write_error(error, error_cap, L"No Windows OCR language is installed");
            return 0;
        }
        const auto result = engine.RecognizeAsync(bitmap).get();
        const std::wstring text(result.Text().c_str());
        const size_t count = (std::min)(output_cap - 1, text.size());
        if (count > 0) std::wmemcpy(output_text, text.data(), count);
        output_text[count] = L'\0';
        return 1;
    } catch (const winrt::hresult_error& e) {
        write_error(error, error_cap, e.message().c_str());
        return 0;
    } catch (...) {
        write_error(error, error_cap, L"Windows OCR failed");
        return 0;
    }
#else
    (void)input_path; (void)output_text; (void)output_cap;
    write_error(error, error_cap,
        L"Windows OCR C++/WinRT headers are not installed. PDF/text indexing remains available.");
    return 0;
#endif
}
