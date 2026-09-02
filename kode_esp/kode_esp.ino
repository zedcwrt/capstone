#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SoftwareSerial.h>

// TAMBAHIN LIBRARY INI (Jangan lupa install WiFiManager by tzapu di Arduino IDE)
#include <DNSServer.h>
#include <ESP8266WebServer.h>
#include <WiFiManager.h>

SoftwareSerial espSerial(D5, D6);

// Baris ssid dan password lama dihapus karena diganti otomatis sama WiFiManager

// ============================================================
// GANTI URL ini dengan URL Vercel kamu setelah deploy
// Contoh: "https://health-monitor-xyz.vercel.app/input"
// ============================================================
const char* server = "https://healthmonitor-4x919ds5n-zedcwrts-projects.vercel.app/api/input";
String dataMasuk = "";

void setup() {

  Serial.begin(9600);
  espSerial.begin(9600);

  Serial.println();
  Serial.println("START ESP");

  // ============================================================
  // BAGIAN WIFIMANAGER START
  // ============================================================
  WiFiManager wifiManager;

  // Kalau mau reset Wi-Fi yang tersimpan tiap kali dinyalain (buat testing),
  // lu tinggal lepas komen di bawah ini:
  // wifiManager.resetSettings();

  // Ini bakal bikin Access Point bernama "ESP-Health-Monitor" kalo gak nemu Wi-Fi.
  // Lu tinggal konek ke AP itu pake HP/Laptop buat setting Wi-Fi baru lewat browser.
  if (!wifiManager.autoConnect("ESP-Health-Monitor")) {
    Serial.println("Gagal konek dan time out");
    delay(3000);
    ESP.reset();
    delay(5000);
  }
  // ============================================================
  // BAGIAN WIFIMANAGER END
  // ============================================================

  Serial.println();
  Serial.println("WIFI CONNECTED");

  Serial.print("IP ESP : ");
  Serial.println(WiFi.localIP());
}

void loop() {

  while (espSerial.available()) {

    char c = espSerial.read();
    if (c == '\n') {

      dataMasuk.trim();
      if (dataMasuk.length() > 0) {
        kirimData(dataMasuk);
      }

      dataMasuk = "";
    }
    else {
      dataMasuk += c;
    }
  }
}

// ============================================================
// FUNGSI KIRIM DATA — logika parsing tidak diubah
// ============================================================
void kirimData(String data) {

  int p1 = data.indexOf(',');
  int p2 = data.indexOf(',', p1 + 1);
  int p3 = data.indexOf(',', p2 + 1);
  int p4 = data.indexOf(',', p3 + 1);

  if (
      p1 == -1 ||
      p2 == -1 ||
      p3 == -1 ||
      p4 == -1
     ) {
    Serial.println("FORMAT DATA SALAH");
    return;
  }

  float hr =
    data.substring(0, p1).toFloat();
  float spo2 =
    data.substring(p1 + 1, p2).toFloat();

  float temp =
    data.substring(p2 + 1, p3).toFloat();
  String heartStatus =
    data.substring(p3 + 1, p4);

  String tempStatus =
    data.substring(p4 + 1);

  Serial.println();
  Serial.println("DATA DARI ARDUINO");
  Serial.println(data);

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;

  if (http.begin(client, server)) {

    http.addHeader("Content-Type", "application/json");
    String json = "{";

    json += "\"hr\":";
    json += String(hr, 1);
    json += ",";

    json += "\"spo2\":";
    json += String(spo2, 1);
    json += ",";

    json += "\"temp\":";
    json += String(temp, 1);
    json += ",";
    json += "\"heartStatus\":\"";
    json += heartStatus;
    json += "\",";
    json += "\"tempStatus\":\"";
    json += tempStatus;
    json += "\"";

    json += "}";

    Serial.println();
    Serial.println("JSON DIKIRIM:");
    Serial.println(json);

    int httpCode = http.POST(json);

    Serial.print("HTTP CODE : ");
    Serial.println(httpCode);
    if (httpCode > 0) {

      String payload = http.getString();

      Serial.println("RESPON SERVER:");
      Serial.println(payload);
    }
    else {

      Serial.println("POST GAGAL");
      Serial.println(http.errorToString(httpCode));
    }

    http.end();
  }
  else {

    Serial.println("GAGAL KONEK KE SERVER");
  }
}
