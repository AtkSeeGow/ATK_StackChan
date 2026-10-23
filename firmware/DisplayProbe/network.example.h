#pragma once
// Copy to network.local.h (ignored by version control). Never paste secrets in chat.
// Empty SSID leaves the existing USB mode active.
#define STACKCHAN_WIFI_SSID ""
#define STACKCHAN_WIFI_PASSWORD ""
// localhost is the device itself; use your eventual HTTPS service hostname here.
#define STACKCHAN_SERVER_URL "https://stackchan.example.com"
#define STACKCHAN_DEVICE_TOKEN ""
// Root CA PEM for your HTTPS certificate chain. Certificate checks stay enabled.
#define STACKCHAN_ROOT_CA ""
#define STACKCHAN_NTP_SERVER "pool.ntp.org"
