#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <SoftwareSerial.h>
#include <DNSServer.h>
#include <ESP8266WebServer.h>
#include <WiFiManager.h>

SoftwareSerial espSerial(D5, D6);
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

// Isi sesuai broker MQTT milikmu. Gunakan port TLS jika broker mendukungnya.
const char* mqttHost = "MQTT_BROKER_HOST";
const uint16_t mqttPort = 1883;
const char* mqttUser = "MQTT_USERNAME";
const char* mqttPassword = "MQTT_PASSWORD";
const char* mqttTopic = "cardiotemp/device/esp8266/data";
const char* mqttClientId = "cardiotemp-esp8266";

String dataMasuk = "";
unsigned long lastMqttAttempt = 0;

void reconnectMqtt() {
  if (mqtt.connected()) return;
  if (millis() - lastMqttAttempt < 5000) return;
  lastMqttAttempt = millis();
  Serial.print("Menghubungkan ke MQTT...");
  if (mqtt.connect(mqttClientId, mqttUser, mqttPassword)) {
    Serial.println(" terhubung");
  } else {
    Serial.print(" gagal, rc=");
    Serial.println(mqtt.state());
  }
}

void setup() {
  Serial.begin(9600);
  espSerial.begin(9600);
  Serial.println("\nSTART ESP MQTT");

  WiFiManager wifiManager;
  if (!wifiManager.autoConnect("ESP-Health-Monitor")) {
    Serial.println("Gagal konek WiFi");
    delay(3000);
    ESP.reset();
    delay(5000);
  }

  Serial.print("IP ESP : ");
  Serial.println(WiFi.localIP());
  mqtt.setServer(mqttHost, mqttPort);
}

void loop() {
  if (!mqtt.connected()) reconnectMqtt();
  mqtt.loop();

  while (espSerial.available()) {
    char c = espSerial.read();
    if (c == '\n') {
      dataMasuk.trim();
      if (dataMasuk.length() > 0) kirimData(dataMasuk);
      dataMasuk = "";
    } else {
      dataMasuk += c;
    }
  }
}

void kirimData(String data) {
  int p1 = data.indexOf(','), p2 = data.indexOf(',', p1 + 1);
  int p3 = data.indexOf(',', p2 + 1), p4 = data.indexOf(',', p3 + 1);
  if (p1 == -1 || p2 == -1 || p3 == -1 || p4 == -1) {
    Serial.println("FORMAT DATA SALAH");
    return;
  }

  float hr = data.substring(0, p1).toFloat();
  float spo2 = data.substring(p1 + 1, p2).toFloat();
  float temp = data.substring(p2 + 1, p3).toFloat();
  String heartStatus = data.substring(p3 + 1, p4);
  String tempStatus = data.substring(p4 + 1);

  String json = "{\"hr\":" + String(hr, 1) +
    ",\"spo2\":" + String(spo2, 1) +
    ",\"temp\":" + String(temp, 1) +
    ",\"heartStatus\":\"" + heartStatus +
    "\",\"tempStatus\":\"" + tempStatus + "\"}";

  if (mqtt.connected() && mqtt.publish(mqttTopic, json.c_str())) {
    Serial.println("MQTT PUBLISH: " + json);
  } else {
    Serial.println("MQTT publish gagal");
  }
}

// Dependency Arduino IDE: PubSubClient by Nick O'Leary dan WiFiManager by tzapu.
// Untuk TLS, ganti WiFiClient dengan WiFiClientSecure dan konfigurasi sertifikat broker.
