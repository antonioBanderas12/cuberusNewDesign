import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { exec } from 'child_process';
import rateLimit from 'express-rate-limit';
import JSON5 from 'json5';
import fastJsonParse from 'fast-json-parse';


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

  return `How is "${inputWord}" described in the "${text}" ? Only focus on "${inputWord}", do not summarise the whole text, stay short.`;
};



const secondPrompt = (summaryText) => {

  return `This is the text: "${summaryText}". Extract the semantically relevant entities in **valid JSON format**. Do not include too many entities, only the most relevant ones.

  For each entity, provide:
  - "name": The entity's name.
  - "description": A short definition or explanation.
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
        model: 'deepseek-r1:7b',
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

        console.log(response.data.response);

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




  async function parents(text, ent) {
    console.log("parents ...");
    try {
      
      const response = await axios.post('http://localhost:11434/api/generate', {
        model: 'llama3.1:8b',
        prompt: thirdPrompt(text, ent),
        stream: false,
        temperature: 0.1
      });

      const cleanedFinal = extractJsonUsingRegex(response.data.response);
        if (!cleanedFinal) {
            console.error("Failed to extract valid JSON");
        }

  
      return cleanedFinal;
    } catch (error) {
      console.error("Error during entity extraction:", error);
      throw new Error("Entity extraction failed");
    }
  }





  async function sequences(text, ent) {
    console.log("sequences ...");

    try {
      
      const response = await axios.post('http://localhost:11434/api/generate', {
        model: 'llama3.1:8b',
        prompt: fourthPrompt(text, ent),
        stream: false,
        temperature: 0.1
      });

      const cleanedFinal = extractJsonUsingRegex(response.data.response);
        if (!cleanedFinal) {
            console.error("Failed to extract valid JSON");
        }

  
      return cleanedFinal;
    } catch (error) {
      console.error("Error during entity extraction:", error);
      throw new Error("Entity extraction failed");
    }
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





//main
app.post('/process-text', async (req, res) => {
  console.log(`New request received at ${new Date().toISOString()}`);

  try {
    const { text, selectedInput } = req.body;
    if (!text || !selectedInput) {
      return res.status(400).json({ error: 'Text and Input Word are required' });
    }

    let cleanedText = preprocessText(text);
    console.log("input word: ", selectedInput);
    
    const summary = await summarize(cleanedText, selectedInput)
    console.log("Summary:", summary);

    const extractedEntities = await extractEntities(summary);
    console.log("extractedEntities:", extractedEntities);




// add relations
const entityNames = new Set(extractedEntities.map(e => e.name)); // Keep track of added entities

extractedEntities.forEach(entity => {
    entity.relations.forEach(relation => {
        const [relationName, relationDescription] = relation; // Extract name & description

        if (relationName && !entityNames.has(relationName)) {
            extractedEntities.push({
                name: relationName,
                description: relationDescription || "No description available.",
                status: "related element",
                relations: [],
                parents: []
            });

            entityNames.add(relationName);
        }
    });
});


console.log("Updated extractedEntities with new relation entities:", extractedEntities);






    const parent = await parents(summary, extractedEntities)
    console.log("parent:", parent);


    const sequence = await sequences(summary, extractedEntities)
    console.log("sequence:", sequence);








    //merge

    // Enhance extractedEntities with parent and sequence information
    extractedEntities.forEach(entity => {
      const entityName = entity.name;

      // Find parents: entities listed before the current entity in parent relationships
      entity.parents = parent
        .filter(relation => relation.includes(entityName)) // Find parent arrays containing the entity
        .map(relation => {
          const index = relation.indexOf(entityName);
          return index > 0 ? relation[index - 1] : null; // Get the entity before
        })
        .filter(Boolean); // Remove null values

      // Find sequences: entities listed after the current entity in sequence relationships
      entity.sequence = sequence
        .filter(seq => seq.includes(entityName)) // Find sequences containing the entity
        .map(seq => {
          const index = seq.indexOf(entityName);
          return index < seq.length - 1 ? seq[index + 1] : null; // Get the entity after
        })
        .filter(Boolean); // Remove null values
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