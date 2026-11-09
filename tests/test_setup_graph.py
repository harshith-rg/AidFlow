"""scripts/setup_graph.py installs the larger road graph the service loads (Phase 6).

All tests run in a temporary folder with fake files, so they never touch the real
graph, never use the internet and never download anything. The download step is
replaced by a stand-in.
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from app.services.graph_loader import DEFAULT_GRAPH_PATH

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def load_setup_module():
    spec = importlib.util.spec_from_file_location(
        "setup_graph_under_test", PROJECT_ROOT / "scripts" / "setup_graph.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def setup(tmp_path, monkeypatch):
    """The setup module with its target and Phase 0 source moved into tmp_path."""
    module = load_setup_module()
    target = tmp_path / "app" / "data" / "graph" / "bengaluru_coverage_box.graphml"
    source = tmp_path / "phase0" / "output" / "bengaluru_coverage_box.graphml"
    monkeypatch.setattr(module, "TARGET_GRAPH_FILE", target)
    monkeypatch.setattr(module, "PHASE0_GRAPH_FILE", source)
    monkeypatch.setattr(module, "CACHE_DIR", tmp_path / "cache")
    module.downloads = []

    def fake_download(output_path, *args, **kwargs):
        module.downloads.append(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"downloaded graph")

    monkeypatch.setattr(module, "download_graph", fake_download)
    return module


def make_source(setup, content=b"phase0 graph bytes"):
    setup.PHASE0_GRAPH_FILE.parent.mkdir(parents=True, exist_ok=True)
    setup.PHASE0_GRAPH_FILE.write_bytes(content)
    return content


def leftovers(setup):
    return list(setup.TARGET_GRAPH_FILE.parent.glob("*.part"))


# ------------------------------------------------------------ what it installs
def test_setup_installs_the_file_the_service_loads():
    module = load_setup_module()
    assert module.TARGET_GRAPH_FILE == DEFAULT_GRAPH_PATH
    assert DEFAULT_GRAPH_PATH.name == "bengaluru_coverage_box.graphml"


def test_download_box_is_the_measured_coverage_box():
    box = load_setup_module().DEFAULT_BBOX
    assert box == {"west": 77.52, "south": 12.90, "east": 77.68, "north": 13.04}


# ------------------------------------------------------------ order of preference
def test_existing_target_is_kept(setup):
    setup.TARGET_GRAPH_FILE.parent.mkdir(parents=True)
    setup.TARGET_GRAPH_FILE.write_bytes(b"already here")
    make_source(setup)

    setup.setup_graph()

    assert setup.TARGET_GRAPH_FILE.read_bytes() == b"already here"
    assert setup.downloads == []


def test_phase0_copy_is_installed_and_source_is_untouched(setup):
    content = make_source(setup)
    mtime = setup.PHASE0_GRAPH_FILE.stat().st_mtime_ns

    setup.setup_graph()

    assert setup.TARGET_GRAPH_FILE.read_bytes() == content
    assert setup.PHASE0_GRAPH_FILE.read_bytes() == content
    assert setup.PHASE0_GRAPH_FILE.stat().st_mtime_ns == mtime
    assert setup.downloads == []
    assert leftovers(setup) == []


def test_download_is_used_when_there_is_no_phase0_copy(setup):
    setup.setup_graph()
    assert setup.downloads == [setup.TARGET_GRAPH_FILE]
    assert setup.TARGET_GRAPH_FILE.read_bytes() == b"downloaded graph"


def test_download_flag_ignores_the_phase0_copy(setup):
    make_source(setup)
    setup.setup_graph(download=True)
    assert setup.downloads == [setup.TARGET_GRAPH_FILE]


def test_force_replaces_the_existing_target(setup):
    setup.TARGET_GRAPH_FILE.parent.mkdir(parents=True)
    setup.TARGET_GRAPH_FILE.write_bytes(b"old")
    content = make_source(setup, b"new graph")

    setup.setup_graph(force=True)

    assert setup.TARGET_GRAPH_FILE.read_bytes() == content


def test_empty_target_is_replaced(setup):
    setup.TARGET_GRAPH_FILE.parent.mkdir(parents=True)
    setup.TARGET_GRAPH_FILE.write_bytes(b"")
    content = make_source(setup)

    setup.setup_graph()

    assert setup.TARGET_GRAPH_FILE.read_bytes() == content


def test_empty_phase0_copy_falls_back_to_download(setup):
    make_source(setup, b"")
    setup.setup_graph()
    assert setup.downloads == [setup.TARGET_GRAPH_FILE]


# ------------------------------------------------------------ safety
def test_incomplete_copy_never_becomes_the_graph(setup, monkeypatch):
    """A copy that comes out the wrong size is discarded; no half-written graph is left."""
    make_source(setup, b"0123456789")

    def short_copy(src, dst, *args, **kwargs):
        Path(dst).write_bytes(b"0123")  # truncated
        return dst

    monkeypatch.setattr(shutil, "copy2", short_copy)

    setup.setup_graph()

    assert setup.downloads == [setup.TARGET_GRAPH_FILE]  # fell back to download
    assert setup.TARGET_GRAPH_FILE.read_bytes() == b"downloaded graph"
    assert leftovers(setup) == []


def test_failed_copy_leaves_no_partial_file(setup, monkeypatch):
    make_source(setup)

    def broken_copy(src, dst, *args, **kwargs):
        Path(dst).write_bytes(b"x")
        raise OSError("disk full")

    monkeypatch.setattr(shutil, "copy2", broken_copy)

    setup.setup_graph()

    assert leftovers(setup) == []


class FakeGraph:
    def number_of_nodes(self):
        return 3

    def number_of_edges(self):
        return 4


def install_fake_osmnx(monkeypatch, *, save_fails=False, calls=None):
    class FakeSettings:
        use_cache = False
        cache_folder = ""
        log_console = True

    class FakeOsmnx:
        settings = FakeSettings()

        @staticmethod
        def graph_from_bbox(bbox, **kwargs):
            if calls is not None:
                calls.append((bbox, kwargs))
            return FakeGraph()

        @staticmethod
        def save_graphml(graph, path):
            Path(path).write_bytes(b"half")
            if save_fails:
                raise OSError("disk full")

    monkeypatch.setitem(sys.modules, "osmnx", FakeOsmnx)


def test_download_asks_osm_for_the_measured_box_and_drive_roads(tmp_path, monkeypatch):
    module = load_setup_module()
    monkeypatch.setattr(module, "CACHE_DIR", tmp_path / "cache")
    calls = []
    install_fake_osmnx(monkeypatch, calls=calls)
    target = tmp_path / "graph" / "bengaluru_coverage_box.graphml"

    module.download_graph(target)

    assert calls == [((77.52, 12.90, 77.68, 13.04), {"network_type": "drive", "retain_all": True})]
    assert target.exists()
    assert list(target.parent.glob("*.part")) == []


def test_failed_download_save_leaves_no_partial_file(tmp_path, monkeypatch):
    module = load_setup_module()
    monkeypatch.setattr(module, "CACHE_DIR", tmp_path / "cache")
    install_fake_osmnx(monkeypatch, save_fails=True)
    target = tmp_path / "graph" / "bengaluru_coverage_box.graphml"

    with pytest.raises(SystemExit):
        module.download_graph(target)

    assert not target.exists()
    assert list(target.parent.glob("*.part")) == []


# ------------------------------------------------------------ the GraphML stays untracked
def _git(*args):
    return subprocess.run(
        ["git", *args], cwd=PROJECT_ROOT, capture_output=True, text=True, check=False
    )


@pytest.fixture
def in_git_repo():
    result = _git("rev-parse", "--is-inside-work-tree")
    if result.returncode != 0:
        pytest.skip("not a git checkout (or git is not installed)")


def test_graph_files_are_git_ignored(in_git_repo):
    for name in (
        "app/data/graph/bengaluru_coverage_box.graphml",
        "app/data/graph/bengaluru_coverage_box.graphml.part",
        "phase0/output/bengaluru_coverage_box.graphml",
    ):
        assert _git("check-ignore", "-q", name).returncode == 0, f"{name} is not git-ignored"


def test_no_graph_file_is_tracked(in_git_repo):
    tracked = _git("ls-files").stdout.splitlines()
    assert [f for f in tracked if f.endswith((".graphml", ".graphml.part"))] == []
