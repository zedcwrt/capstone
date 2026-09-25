#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <WiFiManager.h>

// Isi nilai HiveMQ Cloud sebelum upload firmware.
// Jangan commit password asli ke repository.
const char* mqttHost = "YOUR_HIVEMQ_CLOUD_HOST";
const uint16_t mqttPort = 8883;
const char* mqttUser = "YOUR_MQTT_USERNAME";
const char* mqttPassword = "YOUR_MQTT_PASSWORD";
const char* mqttTopic = "health-monitor/sensors";

// UART dari modul sensor. Sesuaikan jika kabel memakai pin berbeda.
constexpr int SENSOR_RX_PIN = 16;
constexpr int SENSOR_TX_PIN = 17;
constexpr uint32_t SERIAL_BAUD = 9600;

HardwareSerial sensorSerial(2);
WiFiClientSecure tlsClient;
PubSubClient mqtt(tlsClient);
String dataMasuk;
unsigned long lastMqttAttempt = 0;

void reconnectMqtt() {
  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) return;
  const unsigned long now = millis();
  if (now - lastMqttAttempt < 5000) return;
  lastMqttAttempt = now;

  const String clientId = "esp32-health-" + String((uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFF), HEX);
  Serial.println("Menghubungkan ke HiveMQ Cloud...");
  if (mqtt.connect(clientId.c_str(), mqttUser, mqttPassword)) {
    Serial.println("MQTT terhubung");
  } else {
    Serial.printf("MQTT gagal, rc=%d\n", mqtt.state());
  }
}

bool isValidPayload(const String& data) {
  int commas = 0;
  for (size_t i = 0; i < data.length(); i++) {
    if (data[i] == ',') commas++;
  }
  return commas == 4;
}

void publishSensorData(String data) {
  data.trim();
  if (!isValidPayload(data)) {
    Serial.println("FORMAT DATA SALAH: gunakan hr,spo2,temp,heartStatus,tempStatus");
    return;
  }

  if (!mqtt.connected()) {
    Serial.println("MQTT belum terhubung; data tidak dikirim");
    return;
  }

  if (mqtt.publish(mqttTopic, data.c_str(), true)) {
    Serial.print("MQTT PUBLISH: ");
    Serial.println(data);
  } else {
    Serial.println("MQTT PUBLISH GAGAL");
  }
}

void setup() {
  Serial.begin(115200);
  sensorSerial.begin(SERIAL_BAUD, SERIAL_8N1, SENSOR_RX_PIN, SENSOR_TX_PIN);

  WiFiManager wifiManager;
  wifiManager.setConfigPortalTimeout(180);
  if (!wifiManager.autoConnect("ESP32-Health-Monitor")) {
    Serial.println("WiFi gagal terhubung; restart...");
    ESP.restart();
  }

  // TLS tetap aktif. Verifikasi CA dapat ditambahkan untuk produksi.
  tlsClient.setInsecure();
  mqtt.setServer(mqttHost, mqttPort);
  Serial.println("WIFI CONNECTED");
  Serial.println(WiFi.localIP());
}

void loop() {
  reconnectMqtt();
  mqtt.loop();

  while (sensorSerial.available()) {
    const char c = (char)sensorSerial.read();
    if (c == '\n' || c == '\r') {
      if (dataMasuk.length() > 0) {
        publishSensorData(dataMasuk);
        dataMasuk = "";
      }
    } else if (dataMasuk.length() < 160) {
      dataMasuk += c;
    } else {
      dataMasuk = "";
      Serial.println("Payload terlalu panjang; dibuang");
    }
  }
}
