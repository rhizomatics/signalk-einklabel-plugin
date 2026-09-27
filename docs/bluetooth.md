# Bluetooth

Advice for getting a reliable Bluetooth Low Energy (BLE) connection between the SignalK server and your labels.

Bluetooth can be used in of three ways by a plugin:

- Direct access to dongle (usually `hci0` device). Not recommended
- Access via `bluez` and `dbus` services. Better but not ideal
- Using the BLE Manager added to SignalK in 2026. Recommended with caveats.
  - "Use the SignalK BLE Manager API" setting is enabled, the adapter and its lifecycle are managed by the SignalK server, under its own Bluetooth admin settings, once for every BLE-consuming plugin.
  - Under the hood, this uses `bluez` and `dbus` however manages them so that plugins are controlled in how they can impact each other
  - It also has a very useful GUI for seeing all scanned devices, and all GATT claims (GATT being the protocol for directly connecting to BLE devices).
  - This is still new and settling down, so not yet the default for this plugin

The advice here is general to Bluetooth on Linux, whichever way its being used.

## Choosing a Bluetooth Adapter

First step is having a Bluetooth Low Energy (BLE) compatible bluetooth adapter available.

- Bluetooth adapters for Linux can be tricky
- TP-Link UB400 and Asus USB-BT500 are two well-known and available ones, though the ASUS USB-BT500 one can have problems with some Pi type boards (see [Adapter stops responding](#adapter-stops-responding-no-gpio-to-reset))
- CSR4.0 dongles (CSR8510 chip) have had kernel support for years, and there are well known work arounds for some of them, including in the Linux kernel since v5.17
- Some Raspberry Pi models come with suitable Bluetooth built in
- See advice at [Recommended Bluetooth Adapters for Linux](https://github.com/morrownr/USB-WiFi/blob/main/home/Recommended_Bluetooth_Adapters_for_Linux.md)
- Bluetooth adapters typically prefer being in USB2.0 ports rather than USB3.0 ports, since often the USB3.0 implementation leaks radio energy on the same 2.4Ghz spectrum as Bluetooth. If no USB2.0 port available, try a shielded USB2.0 extension lead to distance the dongle from the port. Some dongle manufacturees seems to do a better job at shielding for this than others.

> - Don't worry about the very latest Bluetooth versions, 4.0 is minimum for BLE, 5.0 is nice
> - Home Assistant is massively more popular than SignalK, and often also run on Raspberry Pi and similar, so good source of advice

SignalK BLE Manager also supports BLE Gateways, which could be an MQTT topic or an ESP-32 device. The [espos-ble-gateway](https://github.com/dirkwa/espos-ble-gateway) can be used with a cheap ESP32 device (see the list of supported hardware), which allows positioning of the gateway closer to devices, or having multiple gateways on a big boat.

## Weak Signal

If the label is too far from the SignalK server's adapter, try a BLE proxy device - ESP32 is popular for this - or, with the BLE Manager API, a remote BLE gateway.

If your dongle is plugged into a USB3 port (usually blue-highlighted), then there's a good chance the [infamous USB3 interference on the 2.4Ghz spectrum](https://www.usb.org/sites/default/files/327216.pdf) is impacting your adapter. Switch to a USB2 port if you have one, or better, use a USB extension cable to position the dongle far away.

## Bluetooth Plugins Impacting Each Other

Bluetooth plugins can kick off scanning, and otherwise interfere with each other. Worst case is when plugins attempt to connect directly to Bluetooth adapters. Better is when they connect using `bluez` and `dbus` Linux components, and best of all when they use the SignalK BLE Manager added in 2026.

If you're having problems with Bluetooth connections, make sure other plugins are well behaved, using BLE Manager where they can, and consider temporarily switching them off if needed to debug label connections.

## Stuck Bluetooth Adapters

Sometime Bluetooth adapters, and/or the Linux services that use them, can get into a 'stuck' state, where the only solution is to reboot the server (although unplugging and plugging the dongle may help). The best way to avoid this is using a known good dongle, and using BLE Manager in SignalK wherever possible.

## Tuning Bluetooth Connections

Labels spend most of their time asleep, so they can be slow to accept a connection, and slow to answer while an image is being sent to them. Linux's Bluetooth defaults are set with phones, headphones and sensors in mind, so if connections to labels regularly time out, or drop partway through a repaint (for example with GATT or connection-abort errors in the log), some Bluetooth settings on the server may need adjusting:

- **The plugin's own timeouts** - the _Paint connect timeout_ and _Paint retries_, set plugin-wide or per label (see [Setting up a Label](getting-started.md#setting-up-a-label)). Try these first, since they only affect this plugin.
- **BlueZ's connection settings**, in the `[LE]` section of `/etc/bluetooth/main.conf` - the connection interval range (`MinConnectionInterval`/`MaxConnectionInterval`), how long a quiet connection is kept before it's dropped (`ConnectionSupervisionTimeout`), and how long a connection attempt waits (`Autoconnecttimeout`). The file's own comments describe each one. Restart the Bluetooth service after changing it.
- **The kernel's Bluetooth settings** for the adapter, under `/sys/kernel/debug/bluetooth/hci0/` - such as `supervision_timeout`, `conn_min_interval` and `conn_max_interval`. Values written here are lost on reboot, unless something re-applies them at startup.

These apply whenever the server's Bluetooth goes through BlueZ, including the SignalK BLE Manager with a local adapter. They affect every Bluetooth device the server talks to, not just labels, so change one thing at a time and check that your other Bluetooth equipment still works.

No particular values are recommended here - what works depends on the adapter, the labels and whatever else is using Bluetooth. Get advice before changing them, for example from the [SignalK community](https://signalk.org) or Home Assistant's Bluetooth community, where many of the same adapters and Linux setups are used.

## SignalK starts before the Bluetooth daemon

This and the next section are about direct BlueZ mode only - if the "Use the SignalK BLE Manager API" setting is enabled, adapter/dongle lifecycle is the SignalK server's problem to manage once, for every BLE-consuming plugin, not this plugin's.

The plugin retries BLE adapter initialisation with backoff (starting at 2s, capping at 30s) if `bluetoothd`/D-Bus isn't up yet when the plugin starts, so a slow-starting Bluetooth stack on boot will no longer strand it — it keeps retrying until the adapter appears rather than failing once and giving up. You'll see `BLE adapter not ready … — retrying in Ns …` in the SignalK logs in the meantime.

That said, it's cleaner to fix the boot ordering at the systemd level so the plugin finds the adapter ready on its first attempt. If SignalK runs as a systemd service (`systemctl status signalk`) and its unit file has no `[Unit]` section (check with `systemctl cat signalk`), add one:

```bash
sudo systemctl edit signalk.service
```

This opens an override file — add:

```ini
[Unit]
After=bluetooth.target
Wants=bluetooth.target
```

Save and exit, then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart signalk
```

This tells systemd to start `bluetoothd` first and wait for it before starting SignalK, rather than relying on both racing to start in parallel at boot.

## Adapter stops responding: "No gpio to reset"

Example log:

```
Bluetooth: hci0: No gpio to reset Realtek device, ignoring
Bluetooth: hci0: Unable to disable scanning: -110
Bluetooth: hci0: command 0x2042 tx timeout
Bluetooth: hci0: Opcode 0x2042 failed: -110
```

Adapters like the popular ASUS USB-500 lack a GPIO to allow reset when suspended and it gets stuck, spamming the logs. See [Adapter Goes to Sleep](#adapter-goes-to-sleep) for stopping the auto-suspend happening.

## Adapter Goes to Sleep

This happens when USB autosuspend cycles the dongle in and out of low-power suspend while idle. When bluetoothd sends an HCI command while the device is suspended or mid-resume, it never gets answered

### Example udev rule fix

> [!Note]
> In these examples the dongle is for vendor `0b05` and product `190e`, adapt for your own devices, use `lsusb` to find out, and if there's no `lsusb` command, install the `usbutils` package.

Following file created at `/etc/udev/rules.d/99-bt500-no-autosuspend.rules`

```
# Disable USB autosuspend for the ASUS USB-BT500 (RTL8761BU, 0b05:190e).
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="0b05", ATTR{idProduct}=="190e", TEST=="power/control", ATTR{power/control}="on"
```

### Example tlp fix

If `tlp` running to minimize power, it may have its own rules trying to suspend the Bluetooth dongle.

Following file created at /etc/tlp.d/99-bt500-no-autosuspend.conf

```
USB_DENYLIST="0b05:190e"
```
