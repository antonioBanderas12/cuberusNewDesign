import sys
import json
import spacy
from collections import Counter
from sklearn.decomposition import LatentDirichletAllocation
from sklearn.feature_extraction.text import CountVectorizer

nlp = spacy.load("en_core_web_lg")

text = sys.argv[1]
doc = nlp(text)

# Extracting entities (as Spacy tokens or spans)
entities = [ent for ent in doc.ents]

# Topic Modeling
# vectorizer = CountVectorizer(stop_words="english")
# X = vectorizer.fit_transform([text])
# lda = LatentDirichletAllocation(n_components=3, random_state=42)
# lda.fit(X)

# terms = vectorizer.get_feature_names_out()
# topic_words = []
# for topic_idx, topic in enumerate(lda.components_):
#     topic_words.append([terms[i] for i in topic.argsort()[:-10 - 1:-1]])



# Similarity calculation using SpaCy vectors for entities
# similar_entities = []
# for tw in topic_words:
#     keyword = nlp(" ".join(tw))  # Join words into a string
#     print(f"Keyword: {tw}, Vector size: {keyword.vector.size}")
#     for ent in entities:
#         print(f"Entity: {ent.text}, Vector size: {ent.vector.size}")
#         if ent.vector.size > 0 and keyword.vector.size > 0:
#             similarity = ent.similarity(keyword)
#             if similarity > 0.5:
#                 similar_entities.append({"name": ent.text, "type": ent.label_, "similarity": similarity})




allowed_labels = {"PERSON", "ORG", "GPE", "WORK_OF_ART"}
filtered_entities = [ent for ent in entities if ent.label_ in allowed_labels]





# filtered_entities = [ent for ent in entities if ent.label_ != "PERCENT" and ent.label_ != "MONEY" and ent.label_ != "CARDINAL" and ent.label_ != "SYM" and ent.label_ != "QUANTITY" and ent.label_ != "ORDINAL" and ent.label_ != "TIME" and ent.label_ != "DATE"]


# entity_counts = Counter(entities)
# relevant_entities = [ent for ent in filtered_entities if entity_counts[ent.text] > 1]







seen = set()
final_entities = []
for ent in filtered_entities:
    ent_text = ent.text.lower()  # Normalize text
    if ent_text not in seen:
        final_entities.append({"name": ent.text, "type": ent.label_})
        seen.add(ent_text)


# Remove duplicates by storing only the first occurrence of each entity
# seen = set()  # Track seen entities
# final_entities = []

# for ent in relevant_entities:
#     ent_text = ent.text  # Extract entity text
#     if ent_text not in seen:
#         final_entities.append({"name": ent_text, "type": ent.label_})  # Store as a dictionary
#         seen.add(ent_text)


# Print the filtered, non-duplicate, semantically similar entities
print(json.dumps(final_entities))  # Ensure only JSON output





