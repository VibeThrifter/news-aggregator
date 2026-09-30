"""Wie is dit? (Epic 12): which names in the news are researched by the propaganda-model agents.

- ``roles``       who is this name (politician, journalist, spokesperson, executive, ...)?
- ``priority``    how important is researching it (private persons never)?
- ``pm_coverage`` is it in the propaganda model, with how many relations (read-only)?
- ``pm_client``   queue research targets through the propaganda-model REST API
- ``runner``      start rounds of the propaganda-model agent nieuws-scout + auto-approval
- ``service``     the cycle that ties it together (scheduler job, admin endpoints)
"""
