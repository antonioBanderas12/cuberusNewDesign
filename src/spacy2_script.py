import spacy
import sys
import json
from sentence_transformers import SentenceTransformer, util
from collections import defaultdict

# Load spaCy and Sentence-BERT
nlp = spacy.load("en_core_web_sm")
sbert_model = SentenceTransformer("all-MiniLM-L6-v2")

# Threshold for considering semantic similarity
SIMILARITY_THRESHOLD = 0.85

def extract_entities(text):
    """Extract named entities from text using spaCy."""
    doc = nlp(text)
    entities = defaultdict(list)

    for ent in doc.ents:
        # Limit entities to a maximum of two words
        words = ent.text.split()
        if len(words) > 2:
            entity = " ".join(words[:2])
        else:
            entity = ent.text

        entities[ent.label_].append(entity)

    return entities

def merge_similar_entities(entities):
    """Merge semantically similar entities across all entity types."""
    all_entities = [entity for sublist in entities.values() for entity in sublist]
    merged = []
    for entity in all_entities:
        if not merged or all(util.pytorch_cos_sim(
            sbert_model.encode(entity, convert_to_tensor=True),
            sbert_model.encode(existing, convert_to_tensor=True)
        ).item() < SIMILARITY_THRESHOLD for existing in merged):
            merged.append(entity)
    
    return merged

def compute_relevance(text, entities):
    """Compute semantic relevance scores for named entities."""
    text_embedding = sbert_model.encode(text, convert_to_tensor=True)
    entity_scores = {}

    for entity in entities:
        entity_embedding = sbert_model.encode(entity, convert_to_tensor=True)
        similarity = util.pytorch_cos_sim(text_embedding, entity_embedding).item()
        entity_scores[entity] = similarity

    # Sort by relevance and keep only the top 25
    ranked_entities = sorted(entity_scores.items(), key=lambda x: x[1], reverse=True)[:25]
    return ranked_entities

def refine_entity_types(entities):
    """Refine entity types based on common patterns."""
    refined_entities = []
    for entity in entities:
        if entity.istitle() and len(entity.split()) == 2:
            refined_entities.append((entity, "PERSON"))
        elif "Journal" in entity or "Theory" in entity:
            refined_entities.append((entity, "WORK_OF_ART"))
        elif entity.isupper():
            refined_entities.append((entity, "ORG"))
        else:
            refined_entities.append((entity, "CONCEPT"))
    return refined_entities

def main():
    """Reads input text from CLI, processes entities, and prints JSON output."""
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No input text provided"}))
        sys.exit(1)

    input_text = sys.argv[1]
    entities = extract_entities(input_text)
    merged_entities = merge_similar_entities(entities)
    ranked_entities = compute_relevance(input_text, merged_entities)
    refined_entities = refine_entity_types([entity for entity, _ in ranked_entities])

    result = [{"entity": entity, "type": entity_type, "score": score} 
              for (entity, score), (_, entity_type) in zip(ranked_entities, refined_entities)]
    
    print(json.dumps(result))  # Output JSON for JavaScript parsing

if __name__ == "__main__":
    main()
