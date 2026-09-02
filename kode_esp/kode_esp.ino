#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <SoftwareSerial.h>
#include <PubSubClient.h>
#include <DNSServer.h>
#include <ESP8266WebServer.h>
#include <WiFiManager.h>

SoftwareSerial espSerial(D5, D6);
WiFiClientSecure tlsClient;
PubSubClient mqtt(tlsClient);
const char* mqttHost = "YOUR_HIVEMQ_CLOUD_HOST";
const int mqttPort = 8883;
const char* mqttUser = "YOUR_MQTT_USERNAME";
const char* mqttPassword = "YOUR_MQTT_PASSWORD";
const char* mqttTopic = "health-monitor/sensors";
String dataMasuk;

void reconnect() {
  while (!mqtt.connected()) {
    Serial.println("Menghubungkan ke HiveMQ Cloud...");
    String clientId = "esp-health-" + String(ESP.getChipId(), HEX);
    if (mqtt.connect(clientId.c_str(), mqttUser, mqttPassword)) Serial.println("MQTT terhubung");
    else { Serial.printf("MQTT gagal, rc=%d\n", mqtt.state()); delay(5000); }
  }
}

void setup() {
  Serial.begin(9600); espSerial.begin(9600);
  WiFiManager wifiManager;
  if (!wifiManager.autoConnect("ESP-Health-Monitor")) { ESP.reset(); delay(5000); }
  tlsClient.setInsecure(); // Untuk produksi, gunakan root CA HiveMQ Cloud.
  mqtt.setServer(mqttHost, mqttPort);
  Serial.println("WIFI CONNECTED");
}

void loop() {
  if (!mqtt.connected()) reconnect();
  mqtt.loop();
  while (espSerial.available()) {
    char c = espSerial.read();
    if (c == '\n') { dataMasuk.trim(); if (dataMasuk.length()) kirimData(dataMasuk); dataMasuk = ""; }
    else dataMasuk += c;
  }
}

void kirimData(String data) {
  int p1=data.indexOf(','), p2=data.indexOf(',',p1+1), p3=data.indexOf(',',p2+1), p4=data.indexOf(',',p3+1);
  if (p1<0 || p2<0 || p3<0 || p4<0) { Serial.println("FORMAT DATA SALAH"); return; }
  String payload = data.substring(0, p1) + "," + data.substring(p1+1, p2) + "," + data.substring(p2+1, p3) + "," + data.substring(p3+1, p4) + "," + data.substring(p4+1);
  if (mqtt.publish(mqttTopic, payload.c_str(), true)) { Serial.print("MQTT PUBLISH: "); Serial.println(payload); }
  else Serial.println("MQTT PUBLISH GAGAL");
}
