# Top Bar World Clock

A GNOME Shell extension that shows the time in multiple timezones in the top bar.

## Features

- Add as many clocks as you like, each with its own label
- Choose which clocks appear in the top bar; every clock is listed in the menu
- The menu shows each clock's day (today, tomorrow or yesterday), its offset from your local time and its date
- Searchable timezone picker, or enter any IANA identifier such as `America/Argentina/Buenos_Aires`
- 12-hour, 24-hour or system time format, with optional seconds
- Placement on the left, center or right of the top bar

## Requirements

- GNOME Shell 45–50

## Installation

### From source

```bash
glib-compile-schemas schemas/
zip -r topbar-world-clock@steerch.com.shell-extension.zip \
  metadata.json extension.js prefs.js stylesheet.css schemas/*.gschema.xml LICENSE
gnome-extensions install --force topbar-world-clock@steerch.com.shell-extension.zip
```

Log out and back in (on Wayland), then enable it:

```bash
gnome-extensions enable topbar-world-clock@steerch.com
```

## Settings

Open them from the indicator menu (**Settings**) or with `gnome-extensions prefs topbar-world-clock@steerch.com`.

**Clocks:** use **+** to add a clock. Each row lets you rename the clock, toggle whether it shows in the top bar, move it up or down, or remove it. If none of the clocks are shown in the top bar, a clock icon is shown there instead.

| Setting | Default | Options |
| --- | --- | --- |
| Clocks | New York, London, Tokyo | |
| Time format | System default | System default, 12-hour, 24-hour |
| Show seconds | Off | |
| Show labels in the top bar | On | |
| Top bar position | Center | Left, Center, Right |

## Troubleshooting

**A clock is missing.** Clocks with an unknown timezone identifier are skipped. Check the logs:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep topbar-world-clock
```

## License

Licensed under the GNU General Public License v2.0 or later. See [LICENSE](LICENSE).
