"""Summarise JUnit XML and JaCoCo results as workflow annotations.

Prints one ::notice with the totals (and line coverage, if a JaCoCo report
exists) and one ::error per failing test, so results are visible on the run
page without downloading logs.

    python3 junit_report.py <junit-xml-dir> [jacoco.xml]
"""

import glob
import os
import sys
import xml.etree.ElementTree as ET


def one_line(text: str, limit: int = 600) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 3] + "..."


def main() -> int:
    report_dir = sys.argv[1]
    jacoco = sys.argv[2] if len(sys.argv) > 2 else None
    tests = failures = errors = skipped = 0
    failed = []
    for path in sorted(glob.glob(os.path.join(report_dir, "*.xml"))):
        suite = ET.parse(path).getroot()
        tests += int(suite.get("tests", 0))
        failures += int(suite.get("failures", 0))
        errors += int(suite.get("errors", 0))
        skipped += int(suite.get("skipped", 0))
        for case in suite.iter("testcase"):
            for kind in ("failure", "error"):
                node = case.find(kind)
                if node is not None:
                    detail = (node.get("message") or "") + " " + (node.text or "")[:1500]
                    failed.append(f"{case.get('classname')}.{case.get('name')}: {one_line(detail)}")

    summary = f"tests={tests} passed={tests - failures - errors - skipped} failed={failures + errors} skipped={skipped}"
    if jacoco and os.path.exists(jacoco):
        root = ET.parse(jacoco).getroot()
        for counter in root.findall("counter"):
            if counter.get("type") == "LINE":
                missed, covered = int(counter.get("missed")), int(counter.get("covered"))
                summary += f" line_coverage={100 * covered / (missed + covered):.1f}%"
    print(f"::notice title=Test results::{summary}")
    for f in failed[:40]:
        print(f"::error title=Test failed::{f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
