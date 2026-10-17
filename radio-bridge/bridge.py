import os
import time

import requests
from meshtastic.serial_interface import SerialInterface
from pubsub import pub


API_URL = os.getenv("LORA_API_URL", "http://127.0.0.1:3001/api/lora/messages")
API_TOKEN = os.getenv("LORA_GATEWAY_TOKEN")
GATEWAY_ID = os.getenv("LORA_GATEWAY_ID")


def on_receive(packet, interface):
	decoded = packet.get("decoded") or {}
	message = decoded.get("text")
	if not isinstance(message, str) or not message.strip():
		return

	sender_id = packet.get("fromId") or packet.get("from")
	if sender_id is None:
		print("Ignoring radio text message without a sender ID")
		return

	payload = {
		"gatewayId": GATEWAY_ID,
		"radioId": str(sender_id),
		"message": message,
	}
	headers = {"Authorization": f"Bearer {API_TOKEN}"}

	try:
		response = requests.post(API_URL, json=payload, headers=headers, timeout=10)
		response.raise_for_status()
		print(f"Forwarded radio message from {sender_id}")
	except requests.RequestException as error:
		print(f"Could not forward radio message from {sender_id}: {error}")


def main():
	if not API_TOKEN:
		raise RuntimeError("Set LORA_GATEWAY_TOKEN to the token configured on the CivicLine server")
	if not GATEWAY_ID:
		raise RuntimeError("Set LORA_GATEWAY_ID to identify this gateway")

	interface = SerialInterface()
	pub.subscribe(on_receive, "meshtastic.receive")
	print(f"LoRa bridge connected; forwarding messages to {API_URL}")

	try:
		while True:
			time.sleep(1)
	except KeyboardInterrupt:
		print("Stopping LoRa bridge")
	finally:
		interface.close()


if __name__ == "__main__":
	main()
