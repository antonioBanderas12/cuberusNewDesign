import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { exec } from 'child_process';
import rateLimit from 'express-rate-limit';
import JSON5 from 'json5';
import fastJsonParse from 'fast-json-parse';
import pluralize from 'pluralize';
import fs from 'fs';
import natural from 'natural';
import compromise from 'compromise';


const { JaroWinklerDistance } = natural;

//config
    dotenv.config();
    const app = express();
    const port = 3000;
    const limiter = rateLimit({
      windowMs: 1000, // 1 second
      max: 1, // Allow only 1 request per second
    });
    app.use(cors());
    app.use(express.json());
    //app.use('/process-text', limiter);




// Preprocess text
    const preprocessText = (text) => {
      console.log("Step 1: Preprocessing text...");
      return text.replace(/\s+/g, ' ').trim();
    };


//LLM




const firstPrompt = (text, inputWord) => {

  return `How is "${inputWord}" described in the "${text}"? Focus on "${inputWord}", do not summarise the whole text, but be detailled in regards towards "${inputWord}".`;
};


//  Do not include too many entities, only the most relevant ones.
const secondPrompt = (summaryText) => {

  return `This is the text: "${summaryText}". Extract the semantically relevant entities in **valid JSON format**. Do not include too many entities, only the most relevant ones.

  For each entity, provide:
  - "name": The entity's name in one word.
  - "description": A definition or explanation.
  - "status": Its category or classification.
  - "relations": A list of tuples that show relationships with other entities and describe the nature of this relationship.


 **Example Output:**
  \`\`\`json
    [
      {
        "name": "car",
        "description": "A wheeled motor vehicle used for transportation...",
        "status": "transportation mode",
        "relations": [
          ["engine", "Powered by internal combustion or electric motors"],
          ["hybrid_car", "Uses both traditional and electric propulsion"]
        ]
      }
    ]
  \`\`\`


  Ensure output is in **valid JSON format**, without extra text.
  
  `;
};




const thirdPrompt = (summaryText, ent) => { 
  const entityNames = JSON.stringify(ent.map(e => e.name));

  return `Based on the information provided in "${summaryText}", organize only the following entities: ${entityNames}.
  
  - Categorize the entities into superordinate and subordinate relationships.
  - An entity can be a superordinate entity for multiple entities.
  - An entity can also be subordinate to multiple superordinate entities.
  - Return the relationships in the following JSON format, where each array represents a hierarchical relationship:
  
  \`\`\`json
  [
    ["Superordinate Entity 1", "Subordinate Entity 1", "Subordinate Entity 2"],
    ["Superordinate Entity 2", "Subordinate Entity 3", "Subordinate Entity 4"],
    ["Superordinate Entity 1", "Subordinate Entity 3", "Subordinate Entity 5"]
  ]
  \`\`\`
  
  Ensure that the JSON output is valid and properly formatted.`;
};







const fourthPrompt = (summaryText, entities) => {
  const entityNames = JSON.stringify(entities.map(e => e.name));

  return `Based on the information provided in "${summaryText}", identify meaningful sequences among the following entities: ${entityNames}.
  
  - Determine sequences in which the entities naturally follow each other in a structured order.
  - An entity can be part of multiple sequences.
  - Return the sequences in the following valid JSON format, where each array represents an ordered sequence of entities:
  
  \`\`\`json
  [
    ["Entity 1", "Entity 2", "Entity 3"],
    ["Entity 2", "Entity 4", "Entity 5"]
  ]
  \`\`\`
  
  Ensure that the JSON output is valid, well-structured, and accurately represents meaningful sequences.`;
};









  async function summarize(text, inputWord) {
    try {
      console.log("summarize ...");
      
      const response = await axios.post('http://localhost:11434/api/generate', {
        model: 'deepseek-r1:7b', // deepseek-r1:7b
        prompt: firstPrompt(text, inputWord),
        stream: false,
        temperature: 0.1
      });
  

      let answer = response.data.response
      const cleanedSummary = answer.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  
      return cleanedSummary;
    } catch (error) {
      console.error("Error during entity extraction:", error);
      throw new Error("Entity extraction failed");
    }
  }




  async function extractEntities(text) {
    console.log("entities ...");

    try {      
        const response = await axios.post('http://localhost:11434/api/generate', {
            model: 'llama3.1:8b',
            prompt: secondPrompt(text),
            stream: false,
            temperature: 0.1
        });

        if (!response.data || !response.data.response) {
            throw new Error("API response structure is invalid");
        }



        console.log("raw:", response.data.response);



        try {
            const cleanedJson = extractJsonUsingRegex(response.data.response);
            if (!cleanedJson) {
                throw new Error("Extracted JSON is empty or invalid.");
            }

            return cleanedJson;
        } catch (error) {
            console.error("Error parsing JSON:", error.message);
        }

    } catch (error) {
        console.error("Error during entity extraction:", error);
        throw new Error("Entity extraction failed");
    }
}


async function parents(text, ent, attempts = 3) {
  console.log("parents ...");

  for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
          const response = await axios.post('http://localhost:11434/api/generate', {
              model: 'llama3.1:8b',
              prompt: thirdPrompt(text, ent),
              stream: false,
              temperature: 0.1
          });

          const cleanedFinal = extractJsonUsingRegex(response.data.response);
          
          if (cleanedFinal) {
              return cleanedFinal; // Return valid JSON
          }

          console.warn(`Failed to extract valid JSON. Attempt ${attempt} of ${attempts}`);
          await delay(500);
      } catch (error) {
          console.error(`Error during entity extraction (Attempt ${attempt} of ${attempts}):`, error);
      }
  }

  throw new Error("Entity extraction failed after multiple attempts");
}


async function sequences(text, ent, attempts = 3) {
  console.log("sequences ...");

  for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
          const response = await axios.post('http://localhost:11434/api/generate', {
              model: 'llama3.1:8b',
              prompt: fourthPrompt(text, ent),
              stream: false,
              temperature: 0.1
          });

          const cleanedFinal = extractJsonUsingRegex(response.data.response);
          
          if (cleanedFinal) {
              return cleanedFinal; // Return valid JSON
          }

          console.warn(`Failed to extract valid JSON. Attempt ${attempt} of ${attempts}`);
          await delay(500);
      } catch (error) {
          console.error(`Error during entity extraction (Attempt ${attempt} of ${attempts}):`, error);
      }
  }

  throw new Error("Entity extraction failed after multiple attempts");
}


function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function extractJsonUsingRegex(responseText) {
  if (typeof responseText !== "string") {
    console.error("Expected a string in extractJsonUsingRegex but got:", responseText);
    return null;
  }

  const jsonMatch = responseText.match(/```json([\s\S]*?)```/);
if (jsonMatch) {
    const jsonString = jsonMatch[1].trim();
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        console.error("Error parsing JSON:", error);
        return null;
    }
} else {
    console.error("JSON block not found");
    return null;
}

}








// synonym handling

// Process and normalize entities
const normalizeEntityName = (name) => {
  return pluralize.singular(name.toLowerCase());
};

// Fuzzy matching function
function findSimilarEntity(name, entityNames){
  const threshold = 0.8; // Adjust based on similarity needs
  const nameLC = name.toLowerCase();
  return [...entityNames].find(existingName =>
    JaroWinklerDistance(nameLC, existingName.toLowerCase()) >= threshold
  );
};


function singularize(word) {
  // Simple plural to singular conversion (can be expanded for better handling)
  if (word.endsWith('s')) {
    return word.slice(0, -1);
  }
  return word;
}





// Preprocess, summarize, and extract entities
app.post('/process-text', async (req, res) => {
  console.log(`New request received at ${new Date().toISOString()}`);

  try {
    const { text, selectedInput } = req.body;
    if (!text || !selectedInput) {
      return res.status(400).json({ error: 'Text and Input Word are required' });
    }

//preprocess
    let cleanedText = preprocessText(text);
    console.log("input word: ", selectedInput);

//summarize
    const summary = await summarize(cleanedText, selectedInput);
    console.log("Summary:", summary);

//extract entities
    let extractedEntities = await extractEntities(summary);
    console.log("extractedEntities:", extractedEntities);



//normalise writing
// First, normalize entity names and relations
let normalizedEntities = extractedEntities.map(entity => {
  // Normalize the name of the entity
  entity.name = entity.name.toLowerCase(); // Lowercase the entity name

  // Create a set of all entity names for lookup
  const entityNames = new Set(extractedEntities.map(entity => entity.name.toLowerCase()));

  // Normalize relation names to lowercase
  entity.relations = entity.relations.map(relation => {
    return relation.map(rel => {
      // Lowercase the relation name to ensure uniformity
      let lowerCase = rel.toLowerCase();
      let singular = singularize(rel); // Singular form of the relation
      let similar = findSimilarEntity(rel, entityNames); // Fuzzy match using Jaro-Winkler distance

      // Return normalized relation names based on the checks
      if (entityNames.has(lowerCase)) {
        return lowerCase; // Return the exact match (case-insensitive)

      } else if (entityNames.has(singular)) {
        return singular; // Return the singular form if it exists

      }else if (similar !== undefined) {
        return similar; // Return a similar entity if found by fuzzy match
      }

      // Otherwise, return the original relation if no match is found
      return rel;
    });
  });

  return entity; // Return the normalized entity
});

console.log("normalised", normalizedEntities)



// add relations
    const entityNamesRel = new Set(normalizedEntities.map(e => e.name)); // Keep track of added entities

    normalizedEntities.forEach(entity => {
        entity.relations.forEach(relation => {
            const [relationName, relationDescription] = relation; // Extract name & description

            let normalisedRelName = relationName.toLowerCase(); 

            if (normalisedRelName && !entityNamesRel.has(normalisedRelName)) {
              normalizedEntities.push({
                    name: normalisedRelName,
                    description: relationDescription || "No description available.",
                    status: "related element",
                    relations: [],
                    parents: []
                });

                entityNamesRel.add(normalisedRelName);
            }
        });
    });








//parents
    const parent = await parents(summary, normalizedEntities);


//sequences
    const sequence = await sequences(summary, normalizedEntities);

//merge
    let normalizedParents =parent.map(relationship => {
      return relationship.map(entity => {

      const entityNamesParents = new Set(normalizedEntities.map(entity => entity.name.toLowerCase()));

          // Lowercase the relation name to ensure uniformity
          let lowerCase = entity.toLowerCase();
          let singular = singularize(entity); // Singular form of the relation
          let similar = findSimilarEntity(entity, entityNamesParents); // Fuzzy match using Jaro-Winkler distance

          // Return normalized relation names based on the checks
          if (entityNamesParents.has(lowerCase)) {
            return lowerCase; // Return the exact match (case-insensitive)

          } else if (entityNamesParents.has(singular)) {
            return singular; // Return the singular form if it exists

          }else if (similar !== undefined) {
            return similar; // Return a similar entity if found by fuzzy match
          }

          return entity; // Return the original entity if no match is found
        });
      });

    console.log("normalizedParents:", normalizedParents);


    let normalizedSequences = sequence.map(relationship => {
      return relationship.map(entity => {
     
      const entityNamesSeq = new Set(normalizedEntities.map(entity => entity.name.toLowerCase()));

          let lowerCase = entity.toLowerCase();
          let singular = singularize(entity);
          let similar = findSimilarEntity(entity, entityNamesSeq);

          if (entityNamesSeq.has(lowerCase)) {
            return lowerCase;

          } else if (entityNamesSeq.has(singular)) {
            return singular;

          }else if (similar !== undefined) {
            return similar;
          }
          return entity; // Return the original entity if no match is found
        });
      });

    console.log("normalizedSequences:", normalizedSequences);





let mergedEntities = normalizedEntities.map(entity => {
  const entityNameMerge = entity.name.toLowerCase(); // Normalize the entity name

  // Normalize and find parents: entities listed before the current entity in parent relationships
  entity.parents = normalizedParents
  .filter(relation => relation.includes(entityNameMerge)) // Find parent arrays containing the entity
  .map(relation => {
    const index = relation.indexOf(entityNameMerge);
    return index > 0 ? relation[index - 1] : null; // Get the entity before
  })
  .filter(Boolean); // Remove null values



// Find sequences: entities listed after the current entity in sequence relationships
entity.sequence = normalizedSequences
  .filter(seq => seq.includes(entityNameMerge)) // Find sequences containing the entity
  .map(seq => {
    const index = seq.indexOf(entityNameMerge);
    return index < seq.length - 1 ? seq[index + 1] : null; // Get the entity after
  })
  .filter(Boolean);
  return entity; // Return the merged entity
});





// Log the enhanced entities to check if parents are now assigned properly
console.log("enhanced entities:", mergedEntities);




//send
    res.json(mergedEntities);
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});









// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
