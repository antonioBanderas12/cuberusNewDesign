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

  return `How is "${inputWord}" described in the "${text}" ? Focus on "${inputWord}", do not summarise the whole text.`;
};



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




const thirdPrompt = (summaryText, entities) => { 
  const entityNames = JSON.stringify(entities.map(e => e.name));

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

        try {
            const cleanedJson = extractJsonUsingRegex(response.data.response);
            if (!cleanedJson) {
                throw new Error("Extracted JSON is empty or invalid.");
            }

            console.log("Parsed JSON:", cleanedJson);
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

const mergeAdjectivesAndNounsFromEntities = (entities) => {
  const mergedEntities = [];

  entities.forEach(entity => {
    // Check if the entity contains an adjective and a noun
    if (entity.name && entity.name.split(' ').length > 1) {
      const words = entity.name.split(' ');
      
      // Check if the first word is an adjective and the second one is a noun
      const doc = compromise(entity.name);  // Create a compromise document from entity name

      let adjectives = doc.adjectives().out('array');
      let nouns = doc.nouns().out('array');
      
      // If both adjective and noun are detected, merge them as a new entity
      if (adjectives.length && nouns.length) {
        mergedEntities.push({
          name: `${adjectives[0]} ${nouns[0]}`,  // Combine adjective and noun
          description: `Merged entity: ${adjectives[0]} ${nouns[0]}`,
          status: 'merged entity',
        });
      }
    }
  });

  return mergedEntities;
};

// Process and normalize entities
const normalizeEntityName = (name) => {
  return pluralize.singular(name.toLowerCase());
};

// Fuzzy matching function
const findSimilarEntity = (name, entityNames) => {
  const threshold = 0.8; // Adjust based on similarity needs
  const nameLC = name.toLowerCase();
  return [...entityNames].find(existingName =>
    JaroWinklerDistance(nameLC, existingName.toLowerCase()) >= threshold
  );
};

// Preprocess, summarize, and extract entities
app.post('/process-text', async (req, res) => {
  console.log(`New request received at ${new Date().toISOString()}`);

  try {
    const { text, selectedInput } = req.body;
    if (!text || !selectedInput) {
      return res.status(400).json({ error: 'Text and Input Word are required' });
    }

    // Preprocess text
    let cleanedText = preprocessText(text);
    console.log("input word: ", selectedInput);

    // Summarize
    const summary = await summarize(cleanedText, selectedInput);
    console.log("Summary:", summary);

    // Extract Entities
    let extractedEntities = await extractEntities(summary);
    console.log("extractedEntities:", extractedEntities);

    // Merge adjectives and substantives from extracted entities
    const mergedEntities = mergeAdjectivesAndNounsFromEntities(extractedEntities);
    console.log("Merged Adjectives and Nouns from Entities:", mergedEntities);

    // Normalize and merge similar entities
    let entityMap = new Map();

    extractedEntities.forEach(entity => {
      let normalizedName = normalizeEntityName(entity.name.toLowerCase());
      let existingEntityName = findSimilarEntity(normalizedName, entityMap.keys());
      let finalName = existingEntityName || normalizedName;

      if (!entityMap.has(finalName)) {
        entityMap.set(finalName, { ...entity, name: finalName });
      } else {
        let existingEntity = entityMap.get(finalName);
        existingEntity.parents = [...new Set([...existingEntity.parents, ...entity.parents])];
        existingEntity.sequence = [...new Set([...existingEntity.sequence, ...entity.sequence])];
      }
    });

    // Add merged adjective-noun entities to the map
    mergedEntities.forEach(mergedEntity => {
      const normalizedEntity = normalizeEntityName(mergedEntity.name);
      if (!entityMap.has(normalizedEntity)) {
        entityMap.set(normalizedEntity, { name: mergedEntity.name, description: mergedEntity.description });
      }
    });

    extractedEntities = [...entityMap.values()];

    // Add related entities
    extractedEntities.forEach(entity => {
      if (entity.relations && Array.isArray(entity.relations)) {
        entity.relations.forEach(relation => {
          const relationName = pluralize.singular(relation[0]);

          if (!entityMap.has(relationName)) {
            entityMap.set(relationName, {
              name: relationName,
              description: "No description available.",
              status: "related entity",
              relations: []
            });
          }
        });
      }
    });

    // Update list after related entities were added
    extractedEntities = [...entityMap.values()];

    // Parents and Sequences (same as before)
    const parent = await parents(summary, extractedEntities);
    const sequence = await sequences(summary, extractedEntities);

    // Merge parent & sequence data
    extractedEntities.forEach(entity => {
      const entityName = entity.name;

      entity.parents = parent
        .filter(relation => relation.some(name => pluralize.singular(name.toLowerCase()) === entityName))
        .map(relation => {
          const index = relation.findIndex(name => pluralize.singular(name.toLowerCase()) === entityName);
          return index > 0 ? pluralize.singular(relation[index - 1].toLowerCase()) : null;
        })
        .filter(Boolean);

      entity.sequence = sequence
        .filter(seq => seq.some(name => pluralize.singular(name.toLowerCase()) === entityName))
        .map(seq => {
          const index = seq.findIndex(name => pluralize.singular(name.toLowerCase()) === entityName);
          return index < seq.length - 1 ? pluralize.singular(seq[index + 1].toLowerCase()) : null;
        })
        .filter(Boolean);
    });

    console.log("Updated extractedEntities:", extractedEntities);

    res.json(extractedEntities);
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});



// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
