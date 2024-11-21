import os
from typing import Optional, TypedDict, List, Dict


class ClusterForkOptions(TypedDict):
    runtime: Optional[str]
    labels: Optional[Dict[str, List[str]]]
    id: Optional[str]
    clusterWorkerId: Optional[str]


def matches_cluster_labels(options: ClusterForkOptions, labels: List[str]) -> int:
    matched = 0
    for label in options.get("labels", {}).get("require", []):
        if label not in labels:
            return 0

    found_any = not options.get("labels", {}).get("any", [])
    for label in options.get("labels", {}).get("any", []):
        if label in labels:
            matched += 1
            found_any = True

    if not found_any:
        return 0

    for label in options.get("labels", {}).get("prefer", []):
        if label in labels:
            matched += 1

    # Ensure non-zero result
    matched += 1
    return matched


def get_cluster_labels() -> List[str]:
    import os
    import platform

    labels = os.environ.get("SCRYPTED_CLUSTER_LABELS", "").split(",") or []
    labels.extend([platform.machine(), platform.system(), platform.node()])
    labels = list(set(labels))
    return labels


def needs_cluster_fork_worker(options: ClusterForkOptions) -> bool:
    return (
        os.environ.get("SCRYPTED_CLUSTER_ADDRESS")
        and options
        and (
            not matches_cluster_labels(options, get_cluster_labels())
            or options.get("clusterWorkerId", None)
        )
    )
