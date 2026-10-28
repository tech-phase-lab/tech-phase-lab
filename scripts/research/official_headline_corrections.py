"""Reviewed title-only corrections bound to the exact official source metadata.

No source/body timestamps, event identities, model accounting or saved evidence
are changed. Callers must first establish the current source revision.
"""
import factual_validation

URL = 'https://nvidianews.nvidia.com/news/nvidia-announces-a-150-billion-share-repurchase-authorization-increase'
TITLE = 'NVIDIA Announces a $150 Billion Share Repurchase Authorization Increase'
TITLE_JA = 'NVIDIA、自社株買い承認枠の1500億ドル増額を発表'


def reviewed_headline(row):
    if (row['source_id'] != 'primary-ir-NVDA' or row['url'] != URL
            or row['title'] != TITLE or row['published_on'] != '2026-09-28'
            or row['truncated']):
        return None
    factual_validation.validate_numbers(TITLE_JA, TITLE)
    factual_validation.validate_amount_relations(TITLE_JA, TITLE)
    return TITLE_JA
