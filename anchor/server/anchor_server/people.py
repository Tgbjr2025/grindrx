"""Google People contact write-back.

Hard boundary enforced in code: Anchor only ever creates or edits contacts
inside its own "Anchor" contact group, with an "(Anchor)" name suffix. It
never touches contacts the user created himself — update_contact refuses any
resourceName not recorded in our own contacts table.
"""

from __future__ import annotations

import json
from typing import Any

from . import config, db, timeutil
from .gcal import _credentials

ANCHOR_GROUP = "Anchor"
NAME_SUFFIX = " (Anchor)"


def _service():
    from googleapiclient.discovery import build

    return build("people", "v1", credentials=_credentials(), cache_discovery=False)


def _dry(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    db.execute(
        "INSERT INTO outbox (ts, channel, payload) VALUES (?, 'people', ?)",
        (timeutil.now_iso(), json.dumps({"action": action, **payload}, default=str)),
    )
    return {"resourceName": f"people/dry-{timeutil.now_iso()}"}


def _ensure_group(svc) -> str:
    groups = svc.contactGroups().list(pageSize=200).execute().get("contactGroups", [])
    for g in groups:
        if g.get("name") == ANCHOR_GROUP:
            return g["resourceName"]
    created = (
        svc.contactGroups()
        .create(body={"contactGroup": {"name": ANCHOR_GROUP}})
        .execute()
    )
    return created["resourceName"]


def create_contact(name: str, phone: str, organization: str | None = None) -> dict[str, Any]:
    """Create a phone-visible contact in the Anchor group. The display name
    always carries the suffix so agent-created entries are unmistakable."""
    display = name if name.endswith(NAME_SUFFIX) else name + NAME_SUFFIX
    if config.DRY_RUN or config.SAFE_MODE:
        return _dry("create_contact", {"name": display, "phone": phone, "organization": organization})
    svc = _service()
    group = _ensure_group(svc)
    body: dict[str, Any] = {
        "names": [{"givenName": display}],
        "phoneNumbers": [{"value": phone}],
        "memberships": [{"contactGroupMembership": {"contactGroupResourceName": group}}],
    }
    if organization:
        body["organizations"] = [{"name": organization}]
    return svc.people().createContact(body=body).execute()


def update_contact(people_resource: str, name: str | None = None, phone: str | None = None) -> dict[str, Any]:
    """Update a contact — allowed ONLY for contacts Anchor itself created."""
    owned = db.q1(
        "SELECT id FROM contacts WHERE people_resource = ? AND origin IN ('anchor', 'backfill')",
        (people_resource,),
    )
    if owned is None:
        raise PermissionError(
            f"Refusing to modify {people_resource}: not an Anchor-created contact. "
            "Anchor never edits contacts the user created himself."
        )
    if config.DRY_RUN or config.SAFE_MODE:
        return _dry("update_contact", {"resource": people_resource, "name": name, "phone": phone})
    svc = _service()
    person = svc.people().get(resourceName=people_resource, personFields="names,phoneNumbers").execute()
    body: dict[str, Any] = {"etag": person["etag"]}
    fields = []
    if name:
        display = name if name.endswith(NAME_SUFFIX) else name + NAME_SUFFIX
        body["names"] = [{"givenName": display}]
        fields.append("names")
    if phone:
        body["phoneNumbers"] = [{"value": phone}]
        fields.append("phoneNumbers")
    return (
        svc.people()
        .updateContact(resourceName=people_resource, body=body, updatePersonFields=",".join(fields))
        .execute()
    )
