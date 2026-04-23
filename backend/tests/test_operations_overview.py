from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def _read(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


class OperationsOverviewTests(unittest.TestCase):
    def test_dashboard_router_exposes_operations_endpoint(self) -> None:
        text = _read("backend/app/routes/dashboard.py")
        self.assertIn('@router.get("/operations"', text)
        self.assertIn("OperationsOverviewOut", text)
        self.assertIn("Depends(require_staff)", text)

    def test_frontend_operations_page_uses_operations_api(self) -> None:
        text = _read("frontend/src/app/operations/page.tsx")
        self.assertIn("api.getOperationsOverview()", text)
        self.assertIn("Recent Failures", text)
        self.assertIn("Onboarding Progress", text)
        self.assertIn("owners and admins", text)

    def test_sidebar_limits_operations_to_staff(self) -> None:
        text = _read("frontend/src/components/Sidebar.tsx")
        self.assertIn('const showOperations = role === "owner" || role === "admin"', text)
        self.assertIn('/operations", label: "Operations"', text)

    def test_project_health_endpoint_and_ui_exist(self) -> None:
        backend = _read("backend/app/routes/projects.py")
        frontend = _read("frontend/src/app/projects/[id]/page.tsx")
        self.assertIn('@router.get("/{project_id}/health"', backend)
        self.assertIn("ProjectHealthOverviewOut", backend)
        self.assertIn("api.getProjectHealth(projectId)", frontend)
        self.assertIn("Project Health", frontend)


if __name__ == "__main__":
    unittest.main()
