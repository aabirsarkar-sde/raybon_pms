from pathlib import Path
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
import json
import time
import re

BASE_URL = "https://zd.plantdata.athsoftware.com"
DASHBOARD_URL = f"{BASE_URL}/home/dashboard"

OUTPUT_DIR = Path("plantdata_export")
RAW_DIR = OUTPUT_DIR / "raw"
META_DIR = OUTPUT_DIR / "metadata"

RAW_DIR.mkdir(parents=True, exist_ok=True)
META_DIR.mkdir(parents=True, exist_ok=True)


def extract_basic_info(html):
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)

    plant = None
    serial = None

    match = re.search(
        r"Plant\s+(.+?)\s+Plant Serial Number",
        text,
        re.IGNORECASE | re.DOTALL
    )

    if match:
        plant = " ".join(match.group(1).split())

    match = re.search(
        r"Plant Serial Number\s+([^\s]+)",
        text,
        re.IGNORECASE
    )

    if match:
        serial = match.group(1)

    return {
        "plant_name": plant,
        "serial_number": serial
    }


def looks_like_valid_plant(html):
    text = BeautifulSoup(
        html,
        "html.parser"
    ).get_text(" ", strip=True)

    required = [
        "Plant",
        "Plant Serial Number",
        "Plant Capacity",
        "Design Parameters"
    ]

    return all(
        x.lower() in text.lower()
        for x in required
    )


with sync_playwright() as p:

    browser = p.chromium.launch(headless=False)

    context = browser.new_context()

    page = context.new_page()

    print("\nOpening PlantData...")

    page.goto(
        DASHBOARD_URL,
        wait_until="networkidle"
    )

    input(
        "\nLog in if required, then press ENTER here..."
    )

    # Find the plant dropdown
    selects = page.locator("select")

    print(f"\nFound {selects.count()} select elements.")

    if selects.count() == 0:
        print("ERROR: Could not find plant dropdown.")
        browser.close()
        exit()

    # Get all options from the first select
    options = selects.nth(0).locator("option")

    plants = []

    for i in range(options.count()):

        option = options.nth(i)

        plant_id = option.get_attribute("value")
        plant_name = option.inner_text().strip()

        if plant_id:
            plants.append({
                "id": plant_id,
                "name": plant_name
            })

    print(f"Found {len(plants)} plants.")

    # Save the ID mapping
    mapping_file = OUTPUT_DIR / "plant_list.json"

    mapping_file.write_text(
        json.dumps(
            plants,
            indent=2,
            ensure_ascii=False
        ),
        encoding="utf-8"
    )

    print(f"Plant list saved to: {mapping_file}")

    successful = 0
    failed = []

    # Extract every plant using its REAL ID
    for index, plant in enumerate(plants, start=1):

        plant_id = plant["id"]
        dropdown_name = plant["name"]

        url = (
            f"{BASE_URL}"
            f"/Home/GetDashboardData"
            f"?plantId={plant_id}"
        )

        print(
            f"\n[{index}/{len(plants)}] "
            f"ID={plant_id}"
        )

        print(f"    {dropdown_name}")

        success = False

        for attempt in range(1, 4):

            try:

                response = context.request.get(
                    url,
                    timeout=30000
                )

                if response.status == 200:

                    html = response.text()

                    if looks_like_valid_plant(html):

                        raw_file = (
                            RAW_DIR /
                            f"plant_{plant_id}.html"
                        )

                        raw_file.write_text(
                            html,
                            encoding="utf-8"
                        )

                        info = extract_basic_info(html)

                        metadata = {
                            "plant_id": plant_id,
                            "dropdown_name": dropdown_name,
                            "endpoint": url,
                            "http_status": response.status,
                            "file": str(raw_file),
                            **info
                        }

                        metadata_file = (
                            META_DIR /
                            f"plant_{plant_id}.json"
                        )

                        metadata_file.write_text(
                            json.dumps(
                                metadata,
                                indent=2,
                                ensure_ascii=False
                            ),
                            encoding="utf-8"
                        )

                        successful += 1
                        success = True

                        print(
                            f"    ✓ SUCCESS"
                        )

                        break

                    else:

                        print(
                            f"    Attempt {attempt}: "
                            "invalid response"
                        )

                else:

                    print(
                        f"    Attempt {attempt}: "
                        f"HTTP {response.status}"
                    )

            except Exception as e:

                print(
                    f"    Attempt {attempt}: {e}"
                )

            time.sleep(2 * attempt)

        if not success:

            failed.append(plant)

            print(
                "    ✗ FAILED"
            )

        # Don't hammer the server
        time.sleep(1)

    # Save failures
    failed_file = OUTPUT_DIR / "failed_plants.json"

    failed_file.write_text(
        json.dumps(
            failed,
            indent=2,
            ensure_ascii=False
        ),
        encoding="utf-8"
    )

    print("\n" + "=" * 60)
    print("SCRAPING COMPLETE")
    print("=" * 60)

    print(f"Total plants found: {len(plants)}")
    print(f"Successfully extracted: {successful}")
    print(f"Failed: {len(failed)}")

    print(f"\nRaw data: {RAW_DIR}")
    print(f"Metadata: {META_DIR}")
    print(f"Plant list: {mapping_file}")
    print(f"Failures: {failed_file}")

    browser.close()